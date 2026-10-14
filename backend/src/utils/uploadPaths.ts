import path from 'path';

/** Каталог с загруженными файлами (в проде — docker volume). */
export const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXT = '[a-z0-9]{1,8}';

/** Имя файла: `<uuid>.<ext>`. Папка тенанта: `tenant-<id>`. */
export const TENANT_DIR_RE = /^tenant-\d+$/;

/**
 * Относительный путь файла внутри uploads. Поддерживаются оба вида:
 *   `<uuid>.<ext>`             — «плоские» файлы (историческая раскладка);
 *   `tenant-<id>/<uuid>.<ext>` — новые файлы, разложенные по тенантам.
 * Никаких `..`, `\` или лишних слэшей — только эти два строгих шаблона.
 */
export const UPLOAD_REL_RE = new RegExp(`^(?:tenant-\\d+/)?${UUID}\\.${EXT}$`, 'i');

/** Тенант-владелец по папке (`tenant-<id>/...`), иначе null. */
export function tenantDirOf(rel: string): number | null {
  const m = /^tenant-(\d+)\//.exec(String(rel));
  return m ? Number(m[1]) : null;
}

/** Относительный путь нового файла тенанта. */
export function tenantRelPath(tenantId: number, filename: string): string {
  return `tenant-${tenantId}/${filename}`;
}

/**
 * Проверяет относительный путь и возвращает абсолютный путь к файлу внутри
 * uploads (или null, если путь небезопасен/некорректен). Защита от обхода каталога.
 */
export function resolveUploadPath(rel: string): string | null {
  const clean = String(rel).split('?')[0].replace(/^\/+/, '');
  if (!UPLOAD_REL_RE.test(clean)) return null;
  const base = path.resolve(UPLOADS_DIR);
  const full = path.resolve(base, clean);
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}
