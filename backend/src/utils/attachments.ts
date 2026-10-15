import path from 'path';

/**
 * Вложения чата: что вообще принимаем и как классифицируем. Отдельный модуль —
 * чтобы тип вложения (картинка/видео/документ) и лимит размера были в одном
 * месте, покрывались тестами и не расходились с фронтендом
 * (frontend-react/src/utils/upload.ts).
 */

/** 20 МБ — предел Telegram Bot API: больше не уедет в зеркалирование чата. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'] as const;
export const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.avi', '.mkv'] as const;
export const DOC_EXT = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.rtf', '.zip', '.rar', '.7z',
] as const;

export type AttachmentKind = 'image' | 'video' | 'file';

const IMAGE = new Set<string>(IMAGE_EXT);
const VIDEO = new Set<string>(VIDEO_EXT);
const ALLOWED = new Set<string>([...IMAGE_EXT, ...VIDEO_EXT, ...DOC_EXT]);

/** Тип вложения по имени файла; null — такое расширение не принимаем. */
export function classifyAttachment(filename: string): AttachmentKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE.has(ext)) return 'image';
  if (VIDEO.has(ext)) return 'video';
  if (ALLOWED.has(ext)) return 'file';
  return null;
}

/** Понятное человеку перечисление разрешённых типов (для текста ошибки). */
export const UPLOAD_HINT =
  'можно картинки, видео и документы (pdf, doc, xls, zip и др.)';
