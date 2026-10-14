-- Multi-tenant SaaS schema. Idempotent: safe to re-run on every migration
-- (CREATE ... IF NOT EXISTS + ALTER ... IF NOT EXISTS).
-- Tenant isolation: rows that belong to a tenant carry tenant_id. The
-- superadmin owns no tenant (tenant_id NULL) and sees all tenants.

CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',   -- 'active' | 'suspended'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seat quota: max concurrent operators + pending invites for the tenant.
-- NULL = unlimited. Superadmin manages this from the owner CRM ("выдать
-- количество инвайт-кодов / мест").
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS operator_limit INTEGER;

CREATE TABLE IF NOT EXISTS operators (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'operator',
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE operators ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'operator';
ALTER TABLE operators ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT true;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
-- Increment to invalidate already-issued JWTs (role change / disable / revoke).
ALTER TABLE operators ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
-- Multitenancy: superadmin has tenant_id NULL; everyone else belongs to a tenant.
ALTER TABLE operators ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_operators_tenant ON operators(tenant_id);
-- Legacy: operator status is derived at runtime from live WS connections, not stored.
ALTER TABLE operators DROP COLUMN IF EXISTS status;

CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'open',
    rating SMALLINT,
    assigned_operator_id INTEGER REFERENCES operators(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE chats ADD COLUMN IF NOT EXISTS client_name VARCHAR(255);
-- Legacy columns that were never populated — drop them.
ALTER TABLE chats DROP COLUMN IF EXISTS client_device;
ALTER TABLE chats DROP COLUMN IF EXISTS client_region;
-- Opaque secret issued on chat creation; proves a websocket/REST caller owns this chat.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS client_token UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_client_token ON chats(client_token) WHERE client_token IS NOT NULL;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_chats_tenant ON chats(tenant_id);
-- Race-free per-chat client number. Previously computed as MAX(client_id)+1
-- (collisions under concurrent inserts); now a dedicated sequence.
CREATE SEQUENCE IF NOT EXISTS chats_client_id_seq;
ALTER TABLE chats ALTER COLUMN client_id SET DEFAULT nextval('chats_client_id_seq');
SELECT setval('chats_client_id_seq',
              GREATEST((SELECT COALESCE(MAX(client_id), 0) FROM chats),
                       (SELECT COALESCE(MAX(id), 0) FROM chats)));

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    sender_id INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    file_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP NULL
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
-- Изоляция файлов: поиск владельца файла по messages.file_url (см. server.ts).
CREATE INDEX IF NOT EXISTS idx_messages_file_url ON messages(file_url) WHERE file_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS canned_responses (
    id SERIAL PRIMARY KEY,
    operator_id INTEGER REFERENCES operators(id) ON DELETE CASCADE,
    shortcut VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL
);

ALTER TABLE canned_responses ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
-- Quick replies (2026-10): category groups variants by operator ("Быстрые ответы").
ALTER TABLE canned_responses ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_canned_responses_operator ON canned_responses(operator_id);
CREATE INDEX IF NOT EXISTS idx_canned_responses_tenant ON canned_responses(tenant_id);

CREATE TABLE IF NOT EXISTS invite_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    created_by INTEGER REFERENCES operators(id),
    used_by INTEGER REFERENCES operators(id),
    used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_tenant ON invite_codes(tenant_id);

-- Fresh installs get the composite PK straight away. Existing databases are
-- migrated in seed.ts (backfill tenant_id → drop old PK → add composite PK).
CREATE TABLE IF NOT EXISTS settings (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    key VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (tenant_id, key)
);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_settings_tenant ON settings(tenant_id);

-- SEC-19: default empty widget_origins for every existing tenant (idempotent).
INSERT INTO settings (tenant_id, key, value)
SELECT id, 'widget_origins', '[]' FROM tenants
ON CONFLICT (tenant_id, key) DO NOTHING;

CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tags ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_tags_tenant ON tags(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_tenant_name ON tags(tenant_id, name) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_tags (
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Telegram integration (section 9). One white-label @bot per tenant.
-- bot_token is AES-256-GCM encrypted (see services/telegram.ts); the key comes
-- from TELEGRAM_TOKEN_KEY (falls back to JWT_SECRET in dev).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_bots (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bot_token TEXT NOT NULL,
    bot_username VARCHAR(255),
    webhook_secret VARCHAR(64) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_bots_tenant ON telegram_bots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_active ON telegram_bots(is_active);

-- Chat origin: 'widget' (default, embedded widget) or 'telegram'.
-- external_id holds the Telegram chat id for telegram-sourced chats.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'widget';
ALTER TABLE chats ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_chats_source_external ON chats(source, external_id);

-- Display info for people who write to a tenant's bot.
CREATE TABLE IF NOT EXISTS telegram_users (
    id SERIAL PRIMARY KEY,
    tg_user_id BIGINT NOT NULL,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    username VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_users_unique ON telegram_users(tenant_id, tg_user_id);

-- ---------------------------------------------------------------------------
-- Billing (2026-10). Self-service signup: a client creates its own tenant and
-- becomes its admin. The tenant starts 'unpaid' — it can log in and browse the
-- whole panel, but every state-changing action is blocked until it pays a plan
-- (enforced in middleware/auth.ts + routes/billing.ts). Paying the plan unlocks
-- the tenant and lets its admin issue operator invite codes.
-- ---------------------------------------------------------------------------

-- Plan catalog. price_cents IS NULL = "цена по запросу" (the Custom plan), which
-- is not purchasable online. Seeded here (idempotent) so it ships with a deploy
-- even when RUN_SEED=false.
CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    price_cents INTEGER,
    operator_limit INTEGER,
    description TEXT NOT NULL DEFAULT '',
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO plans (code, name, price_cents, operator_limit, description, features, sort_order, is_active) VALUES
  ('start', 'Старт', 899, 3, 'Для небольшого сервиса на старте',
   '["Виджет на сайт и Telegram-бот","Автораспределение чатов","Файлы, история и оценки","Статистика и аудит","Изоляция данных по брендам"]'::jsonb, 1, true),
  ('pro', 'Профи', 1399, 10, 'Для растущего VPN-сервиса',
   '["Виджет на сайт и Telegram-бот","Автораспределение чатов","Файлы, история и оценки","Статистика и аудит","Изоляция данных по брендам"]'::jsonb, 2, true),
  ('business', 'Бизнес', 1999, 30, 'Для сети сервисов и команд',
   '["Виджет на сайт и Telegram-бот","Автораспределение чатов","Файлы, история и оценки","Статистика и аудит","Изоляция данных по брендам"]'::jsonb, 3, true),
  ('custom', 'Custom', NULL, NULL, 'Большие объёмы, SLA и white-label',
   '["Всё из «Бизнес»","Операторы без лимита","Персональный SLA","Помощь с миграцией","Индивидуальные доработки"]'::jsonb, 4, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  price_cents = EXCLUDED.price_cents,
  operator_limit = EXCLUDED.operator_limit,
  description = EXCLUDED.description,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order;

-- Tenant billing state. Existing tenants (created before this feature) are
-- grandfathered as 'active' by the ADD COLUMN default; the default is then
-- switched to 'unpaid' so newly registered tenants start locked.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE tenants ALTER COLUMN billing_status SET DEFAULT 'unpaid';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paid_until TIMESTAMP;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_tenants_billing_status ON tenants(billing_status);

-- Promo codes created by the platform owner in the CRM. discount_type 'percent'
-- (0..100) or 'fixed' (USD cents). max_activations NULL = unlimited.
CREATE TABLE IF NOT EXISTS promo_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    discount_type VARCHAR(10) NOT NULL,
    discount_value INTEGER NOT NULL,
    max_activations INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    valid_from TIMESTAMP,
    valid_until TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INTEGER REFERENCES operators(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment / invoice records for tenant subscriptions.
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES plans(id),
    base_cents INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    promo_code_id INTEGER REFERENCES promo_codes(id) ON DELETE SET NULL,
    discount_type VARCHAR(10),
    discount_value INTEGER,
    method VARCHAR(20) NOT NULL DEFAULT 'cryptobot',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    provider_invoice_id VARCHAR(100),
    pay_url TEXT,
    period_days INTEGER NOT NULL DEFAULT 30,
    confirmed_by INTEGER REFERENCES operators(id),
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_invoice ON payments(provider_invoice_id) WHERE provider_invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Ticket templates (constructor). Admin creates/edits; operator uses read-only.
-- ---------------------------------------------------------------------------

-- Auto-update function for updated_at columns
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS ticket_templates (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    schema JSONB NOT NULL DEFAULT '{"fields":[]}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INTEGER REFERENCES operators(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES operators(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ticket_templates_tenant ON ticket_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ticket_templates_active ON ticket_templates(tenant_id, is_active);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'ticket_templates' AND t.tgname = 'ticket_templates_updated_at'
    ) THEN
        CREATE TRIGGER ticket_templates_updated_at
        BEFORE UPDATE ON ticket_templates
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Tickets. Operators fill a template and create a ticket; admins manage them.
-- template_name + template_schema are snapshots, so a ticket stays readable even
-- if the admin later edits or deletes the template it came from.
-- status: 'open' (не решено) | 'resolved' (решено).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    template_id INTEGER REFERENCES ticket_templates(id) ON DELETE SET NULL,
    template_name VARCHAR(150) NOT NULL,
    template_schema JSONB NOT NULL DEFAULT '{"fields":[]}'::jsonb,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    created_by INTEGER REFERENCES operators(id) ON DELETE SET NULL,
    resolved_by INTEGER REFERENCES operators(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_template ON tickets(template_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'tickets' AND t.tgname = 'tickets_updated_at'
    ) THEN
        CREATE TRIGGER tickets_updated_at
        BEFORE UPDATE ON tickets
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;