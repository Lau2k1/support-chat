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
      console.log('Operator already exists, skipping seed.');
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO operators (name, email, password) VALUES ($1, $2, $3)',
      [name, email, hash]
    );
    console.log(`Seed done: operator "${name}" <${email}> created (password: ${password})`);
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await pool.end();
  }
}

seed();
