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
    status VARCHAR(20) DEFAULT 'online',
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
ALTER TABLE chats ADD COLUMN IF NOT EXISTS client_device VARCHAR(255);
ALTER TABLE chats ADD COLUMN IF NOT EXISTS client_region VARCHAR(255);
-- Opaque secret issued on chat creation; proves a websocket/REST caller owns this chat.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS client_token UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_client_token ON chats(client_token) WHERE client_token IS NOT NULL;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_chats_tenant ON chats(tenant_id);

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

CREATE TABLE IF NOT EXISTS canned_responses (
    id SERIAL PRIMARY KEY,
    operator_id INTEGER REFERENCES operators(id) ON DELETE CASCADE,
    shortcut VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL
);

ALTER TABLE canned_responses ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
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