import fs from 'fs';
import path from 'path';
import { pool } from '../db';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
/** Orphan files (not referenced by any message) older than this are removed. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * SEC-02: deletes upload files that are not referenced by any message and are
 * older than MAX_AGE_MS. Guards against disk exhaustion from failed/incomplete
 * uploads and from chats deleted before their files.
 */
export async function cleanupOrphanUploads(): Promise<number> {
  let names: string[];
  try {
    names = await fs.promises.readdir(UPLOADS_DIR);
  } catch {
    return 0;
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  let removed = 0;
  for (const name of names) {
    const full = path.join(UPLOADS_DIR, name);
    try {
      const st = await fs.promises.stat(full);
      if (!st.isFile() || st.mtimeMs > cutoff) continue;
      const ref = await pool.query('SELECT 1 FROM messages WHERE file_url = $1 LIMIT 1', [`/uploads/${name}`]);
      if (ref.rows.length) continue;
      await fs.promises.unlink(full);
      removed++;
    } catch {
      /* ignore individual file errors */
    }
  }
  return removed;
}

/** Runs the orphan cleanup hourly (unref'd so it never keeps the process alive). */
export function startUploadsCleanup(): NodeJS.Timeout {
  const timer = setInterval(() => {
    cleanupOrphanUploads().catch(() => {});
  }, 60 * 60 * 1000);
  timer.unref();
  return timer;
}
