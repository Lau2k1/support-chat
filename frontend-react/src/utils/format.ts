export function formatTime(ms: number | string): string {
  const d = new Date(Number(ms));
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(ts: number | string): string {
  const d = new Date(Number(ts));
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU');
}

export function formatElapsedTime(updatedAt: number): string {
  const diff = Math.floor((Date.now() - updatedAt) / 1000);
  if (diff < 0) return '0м 0с';
  return `${Math.floor(diff / 60)}м ${diff % 60}с`;
}

export function formatDateInput(date: Date): string {
  return date.toISOString().split('T')[0];
}
