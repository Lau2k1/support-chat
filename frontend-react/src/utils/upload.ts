/**
 * Вложения чата: те же типы и лимит, что проверяет бэкенд
 * (backend/src/routes/upload.ts, MAX_UPLOAD_BYTES). Держим их рядом, чтобы
 * клиент не отправлял файл, который сервер заведомо отклонит.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const UPLOAD_ACCEPT = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.avi', '.mkv',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.rtf', '.zip', '.rar', '.7z',
].join(',');

/** Сообщение об ошибке для слишком большого файла, иначе null. */
export function uploadSizeError(file: File): string | null {
  return file.size > MAX_UPLOAD_BYTES ? 'Файл слишком большой (максимум 20 МБ)' : null;
}
