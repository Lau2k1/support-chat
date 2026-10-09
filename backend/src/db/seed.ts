import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pool } from './index';

async function seed() {
  const email = 'admin@test.com';
  const password = 'admin123';
  const name = 'Администратор';

  try {
    const existing = await pool.query('SELECT id FROM operators WHERE email = $1', [email]);
    if (existing.rows.length) {
      await pool.query("UPDATE operators SET role = 'admin' WHERE email = $1", [email]);
      console.log('Admin role updated for existing operator.');
    } else {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        'INSERT INTO operators (name, email, password, role) VALUES ($1, $2, $3, $4)',
        [name, email, hash, 'admin']
      );
      console.log(`Seed done: operator "${name}" <${email}> created (password: ${password})`);
    }

    const settingsExist = await pool.query("SELECT 1 FROM settings WHERE key = 'chat_timeout_minutes'");
    if (!settingsExist.rows.length) {
      await pool.query(`
        INSERT INTO settings (key, value) VALUES
        ('chat_timeout_minutes', $1),
        ('welcome_message', 'Здравствуйте! Чем могу помочь?')
      `, [String(process.env.CHAT_TIMEOUT_MINUTES || 7)]);
      console.log('Default settings seeded.');
    }
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await pool.end();
  }
}

seed();
