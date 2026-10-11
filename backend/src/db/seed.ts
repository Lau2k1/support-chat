import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pool } from './index';

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v !== undefined && v.trim() !== '' ? v.trim() : fallback;
}

async function seed() {
  const isProd = process.env.NODE_ENV === 'production';
  const adminEmail = env('ADMIN_EMAIL', 'admin@test.com');
  const tenantSlug = env('TENANT_SLUG', 'default');
  const tenantName = env('TENANT_NAME', 'Главный офис');
  const tenantAdminEmail = env('TENANT_ADMIN_EMAIL', '');

  // SEC-04: never seed the well-known default password in production.
  let adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword) {
    if (isProd) {
      console.error(
        'SEC-04: ADMIN_PASSWORD must be set in production — refusing to use the default "admin123" password.'
      );
    } else {
      adminPassword = 'admin123';
      console.warn('ADMIN_PASSWORD not set — using default "admin123" (development only).');
    }
  }

  try {
    // 1) Superadmin (globals only — owns the platform, no tenant).
    const existing = await pool.query('SELECT id FROM operators WHERE email = $1', [adminEmail]);
    if (existing.rows.length) {
      await pool.query("UPDATE operators SET role = 'superadmin', tenant_id = NULL WHERE email = $1", [adminEmail]);
      console.log('Superadmin role ensured for existing operator.');
    } else if (adminPassword) {
      const hash = await bcrypt.hash(adminPassword, 10);
      await pool.query(
        "INSERT INTO operators (name, email, password, role, tenant_id) VALUES ($1, $2, $3, 'superadmin', NULL)",
        [env('ADMIN_NAME', 'Администратор'), adminEmail, hash]
      );
      console.log(`Seed done: superadmin "${adminEmail}" created.`);
    } else {
      // SEC-04: production without ADMIN_PASSWORD — do NOT create an account with
      // an empty/known password. Set ADMIN_PASSWORD and restart to provision it.
      console.error('SEC-04: superadmin not created (ADMIN_PASSWORD is not set).');
    }

    // 2) Default tenant (also becomes the backfill target for pre-tenant rows).
    await pool.query(
      'INSERT INTO tenants (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING',
      [tenantSlug, tenantName]
    );
    const tenantRes = await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
    const tenantId: number = tenantRes.rows[0].id;
    console.log(`Default tenant "${tenantName}" (${tenantSlug}) id=${tenantId}`);

    // 3) Backfill anything created before multitenancy into the default tenant.
    await pool.query('UPDATE operators SET tenant_id = $1 WHERE tenant_id IS NULL AND role != $2', [tenantId, 'superadmin']);
    await pool.query('UPDATE chats SET tenant_id = $1 WHERE tenant_id IS NULL', [tenantId]);
    await pool.query('UPDATE tags SET tenant_id = $1 WHERE tenant_id IS NULL', [tenantId]);
    await pool.query('UPDATE invite_codes SET tenant_id = $1 WHERE tenant_id IS NULL', [tenantId]);
    await pool.query('UPDATE canned_responses SET tenant_id = $1 WHERE tenant_id IS NULL', [tenantId]);
    await pool.query('UPDATE settings SET tenant_id = $1 WHERE tenant_id IS NULL', [tenantId]);

    // 4) Migrate old single-key settings to a per-tenant composite PK.
    await pool.query('ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey');
    await pool.query('ALTER TABLE settings ALTER COLUMN tenant_id SET NOT NULL');
    await pool.query('ALTER TABLE settings ADD PRIMARY KEY (tenant_id, key)');

    // 5) Default per-tenant settings (idempotent).
    await pool.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES
         ($1, 'chat_timeout_minutes', $2),
         ($1, 'welcome_message', 'Здравствуйте! Чем могу помочь?'),
         ($1, 'widget_origins', '[]')
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, String(process.env.CHAT_TIMEOUT_MINUTES || 7)]
    );

    // 6) Optional demo tenant-admin for the default tenant (dev convenience).
    const tenantAdminPassword = process.env.TENANT_ADMIN_PASSWORD || (isProd ? '' : 'admin123');
    if (tenantAdminEmail && isProd && !process.env.TENANT_ADMIN_PASSWORD) {
      // SEC-04: never set the default password in production.
      console.warn('SEC-04: skipping tenant admin %s — TENANT_ADMIN_PASSWORD not set.', tenantAdminEmail);
    } else if (tenantAdminEmail) {
      if (!process.env.TENANT_ADMIN_PASSWORD) {
        console.warn('TENANT_ADMIN_PASSWORD not set — using default password for the tenant admin (development only).');
      }
      const tenantExisting = await pool.query('SELECT id FROM operators WHERE email = $1', [tenantAdminEmail]);
      const hash = await bcrypt.hash(tenantAdminPassword, 10);
      if (tenantExisting.rows.length) {
        await pool.query(
          "UPDATE operators SET role = 'admin', tenant_id = $1, password = $2 WHERE email = $3",
          [tenantId, hash, tenantAdminEmail]
        );
        console.log('Tenant admin role ensured.');
      } else {
        await pool.query(
          "INSERT INTO operators (name, email, password, role, tenant_id) VALUES ($1, $2, $3, 'admin', $4)",
          [env('TENANT_ADMIN_NAME', 'Администратор чата'), tenantAdminEmail, hash, tenantId]
        );
        console.log(`Tenant admin created: ${tenantAdminEmail} (tenant id=${tenantId})`);
      }
    }
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await pool.end();
  }
}

seed();