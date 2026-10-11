require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
const TMPL = /^(feat-|fix-|detail-|crm-|ws-)/;
(async () => {
  const rows = (await p.query('SELECT id, slug FROM tenants ORDER BY id')).rows;
  let deleted = 0;
  for (const r of rows) {
    if (!TMPL.test(r.slug)) continue;
    const id = r.id;
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE tenant_id = $1)', [id]);
      await client.query('DELETE FROM chat_tags WHERE chat_id IN (SELECT id FROM chats WHERE tenant_id = $1)', [id]);
      await client.query('DELETE FROM chats WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM canned_responses WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM invite_codes WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM tags WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM settings WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM telegram_users WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM telegram_bots WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM operators WHERE tenant_id = $1', [id]);
      await client.query('DELETE FROM tenants WHERE id = $1', [id]);
      await client.query('COMMIT');
      console.log('deleted tenant', id, r.slug);
      deleted++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('failed', id, e.message);
    } finally {
      client.release();
    }
  }
  const left = (await p.query('SELECT id, slug FROM tenants ORDER BY id')).rows;
  console.log('deleted:', deleted, '| remaining:', JSON.stringify(left));
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });