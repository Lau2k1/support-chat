import fs from 'fs';
import path from 'path';
import { pool } from '../db';
import { UPLOADS_DIR, TENANT_DIR_RE } from '../utils/uploadPaths';

/** Orphan files (not referenced by any message or ticket) older than this are removed. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * SEC-02: deletes upload files that are not referenced by any message or ticket
 * and are older than MAX_AGE_MS. Guards against disk exhaustion from
 * failed/incomplete uploads and from chats deleted before their files.
 *
 * Files live either flat in `uploads/` (historical) or under `uploads/tenant-<id>/`
 * (new layout), so both the root and one level of tenant folders are scanned.
 */
export async function cleanupOrphanUploads(): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(UPLOADS_DIR, { withFileTypes: true });
  } catch {
    return 0;
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  let removed = 0;

  const consider = async (rel: string) => {
    const full = path.join(UPLOADS_DIR, rel);
    try {
      const st = await fs.promises.stat(full);
      if (!st.isFile() || st.mtimeMs > cutoff) return;
      const url = `/uploads/${rel}`;
      const ref = await pool.query('SELECT 1 FROM messages WHERE file_url = $1 LIMIT 1', [url]);
      if (ref.rows.length) return;
      // Вложения тикетов лежат в data поля «Файл» ({ url, name } или строкой),
      // поэтому ищем url подстрокой в JSON — strpos не требует экранирования.
      const inTickets = await pool.query('SELECT 1 FROM tickets WHERE strpos(data::text, $1) > 0 LIMIT 1', [url]);
      if (inTickets.rows.length) return;
      await fs.promises.unlink(full);
      removed++;
    } catch {
      /* ignore individual file errors */
    }
  };

  for (const entry of entries) {
    if (entry.isFile()) {
      await consider(entry.name);
    } else if (entry.isDirectory() && TENANT_DIR_RE.test(entry.name)) {
      const dir = path.join(UPLOADS_DIR, entry.name);
      let children: fs.Dirent[];
      try {
        children = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children) {
        if (child.isFile()) await consider(`${entry.name}/${child.name}`);
      }
      // Remove the tenant folder once it is empty.
      try {
        if ((await fs.promises.readdir(dir)).length === 0) await fs.promises.rmdir(dir);
      } catch {
        /* ignore */
      }
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
