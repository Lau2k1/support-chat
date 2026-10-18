import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { wsManager } from '@/services/ws';

/**
 * Сброс клиентской сессии при смене пользователя.
 *
 * Состояние панели (чаты, имена, превью, вкладки, непрочитанные) живёт в
 * zustand — то есть только в памяти вкладки — и никак не связано с cookie
 * сессии. Плюс `init_operator` из WebSocket лишь дописывает чаты и никогда их
 * не удаляет. Из-за этого после выхода и входа другим аккаунтом оператор видел
 * данные предыдущего тенанта, пока не нажмёт F5.
 *
 * Закрываем и сокет: он авторизован прошлой серверной сессией, поэтому события
 * старого тенанта продолжали бы приходить в общий стор.
 */
export function resetClientSession() {
  useChatStore.getState().reset();
  useUIStore.getState().reset();
  wsManager.disconnect();
}

/**
 * Одна и та же личность? Сравниваем пользователя и тенант: смена любого из них
 * означает другую сессию, а `refresh()` того же пользователя (например, после
 * оплаты) сбрасывать ничего не должен.
 */
export function isSameSession(
  a: { id: number; tenantId: number | null } | null,
  b: { id: number; tenantId: number | null } | null
): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.tenantId === b.tenantId;
}
