import { Pool } from 'pg';

export const pool = new Pool({
  user: 'admin',
  host: 'localhost',
  database: 'support_chat',
  password: 'admin',
  port: 5432,
});