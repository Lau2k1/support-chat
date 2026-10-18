import { useEffect, useCallback } from 'react';
import { wsManager } from '@/services/ws';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { playNewChatSound, playMessageSound } from '@/utils/audio';
import type { WsIncomingMessage } from '@/types/ws';

export function useWebSocket() {
  const {
    setCurrentChat,
    addMessage,
    setChatTimer,
    incrementUnread,
    setPreview,
    setChatSource,
    setChatName,
    setChatPublicCode,
    setChatAssignee,
    setTyping,
    setOnlineOperators,
    currentChatId,
  } = useChatStore();  const { logout } = useAuthStore();
  // Смена пользователя закрывает сокет (см. stores/sessionReset), поэтому
  // вход другим аккаунтом должен поднять соединение заново.
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const showToast = useUIStore((s) => s.showToast);

  const handleMessage = useCallback(
    (data: WsIncomingMessage) => {
      switch (data.type) {
        case 'auth_ok':
          wsManager.send({ type: 'operator_join' });
          wsManager.send({
            type: 'operator_status',
            status: useChatStore.getState().operatorStatus,
          });
          break;

        case 'auth_error':
          logout();
          break;

        case 'init_operator':
          data.chats.forEach((chat) => {
            setChatTimer(String(chat.id), chat.updated_at);
            if (chat.source) setChatSource(String(chat.id), chat.source);
            if (chat.client_name) setChatName(String(chat.id), chat.client_name);
            if (chat.public_code) setChatPublicCode(String(chat.id), chat.public_code);
            if (chat.assigned_operator_id && chat.operator_name) {
              setChatAssignee(String(chat.id), { id: chat.assigned_operator_id, name: chat.operator_name });
            }
          });
          break;

        case 'new_chat':
          setChatTimer(String(data.chatId), data.updated_at);
          if (data.source) setChatSource(String(data.chatId), data.source);
          if (data.client_name) setChatName(String(data.chatId), data.client_name);
          if (data.public_code) setChatPublicCode(String(data.chatId), data.public_code);
          if (data.assigned_operator_id && data.operator_name) {
            setChatAssignee(String(data.chatId), { id: data.assigned_operator_id, name: data.operator_name });
          }
          playNewChatSound();
          break;

        case 'message': {
          const chatId = String(data.message.chat_id);
          addMessage(chatId, data.message);
          // Keep the Telegram client's display name fresh (they may rename in TG).
          if (
            data.message.sender_id === 0 &&
            data.message.sender_name &&
            useChatStore.getState().chatSources[chatId] === 'telegram'
          ) {
            setChatName(chatId, data.message.sender_name);
          }
          if (data.updated_at) {
            setChatTimer(chatId, data.updated_at);
          }
          setPreview(chatId, data.message.content?.substring(0, 40) || '');
          if (String(currentChatId) !== chatId && data.message.sender_id === 0) {
            incrementUnread(chatId);
            playMessageSound();
          } else if (String(currentChatId) === chatId && data.message.sender_id === 0) {
            wsManager.send({ type: 'messageRead', chatId: data.message.chat_id, messageId: data.message.id });
          }
          break;
        }

        case 'chat_closed':
          useChatStore.getState().removeChat(data.chatId);
          useChatStore.getState().removeTab(data.chatId);
          if (currentChatId === data.chatId) {
            setCurrentChat(null);
          }
          break;

        case 'chat_error':
          showToast(data.error, 'error');
          break;

        case 'operators_status':
          setOnlineOperators(data.operators);
          break;

        case 'typingStart':
          setTyping(data.chatId, true);
          break;

        case 'typingStop':
          setTyping(data.chatId, false);
          break;

        case 'chat_transferred':
          // The chat now belongs to this operator; the `new_chat` event that
          // follows (see ws/handler.ts) adds it to the sidebar. Acknowledge it.
          showToast('Вам передан чат', 'info');
          break;

        case 'chat_assigned':
          setChatAssignee(String(data.chatId), { id: data.operatorId, name: data.operatorName });
          break;
      }
    },
    [addMessage, setChatTimer, incrementUnread, setPreview, setChatSource, setChatName, setChatPublicCode, setChatAssignee, setTyping, setOnlineOperators, currentChatId, setCurrentChat, logout, showToast]
  );

  useEffect(() => {
    wsManager.connect();
    const unsub = wsManager.subscribe(handleMessage);
    return () => {
      unsub();
    };
  }, [handleMessage, userId]);
}
