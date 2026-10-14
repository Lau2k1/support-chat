/**
 * Извлекает изображения из события вставки (Ctrl+V).
 *
 * Браузер кладёт скопированную картинку в `clipboardData.items` как файл с
 * MIME-типом `image/*`. Мы поддерживаем только форматы из allowlist бэкенда
 * (png/jpeg/webp/gif) и даём файлу осмысленное имя с нужным расширением —
 * сервер определяет по расширению, картинка это или просто файл.
 */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function imageFilesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files: File[] = [];
  const stamp = Date.now();
  let i = 0;
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const ext = MIME_EXT[item.type];
    if (!ext) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    files.push(new File([blob], `pasted-${stamp}-${i++}.${ext}`, { type: item.type }));
  }
  return files;
}
