import { useCallback, useRef } from 'react';
import { wsManager } from '@/services/ws';

export function useTyping() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TYPING_STOP_DELAY = 1000;

  const handleTyping = useCallback((chatId: number | null) => {
    if (!chatId) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    wsManager.send({ type: 'typingStart', chatId });
    timeoutRef.current = setTimeout(() => {
      wsManager.send({ type: 'typingStop', chatId });
    }, TYPING_STOP_DELAY);
  }, []);

  const stopTyping = useCallback((chatId: number | null) => {
    if (!chatId) return;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    wsManager.send({ type: 'typingStop', chatId });
  }, []);

  return { handleTyping, stopTyping };
}
