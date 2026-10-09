import { useEffect, useRef, useCallback, useState } from 'react';

interface WidgetMessage {
  id: number;
  chat_id: number;
  sender_id: number;
  sender_name?: string;
  content: string;
  message_type: 'text' | 'image' | 'file' | 'note';
  file_url?: string | null;
  created_at: number;
}

type WsInMsg =
  | { type: 'chat_created'; chatId: number }
  | { type: 'message'; message: WidgetMessage; updated_at: number }
  | { type: 'typingStart'; chatId: number }
  | { type: 'typingStop'; chatId: number }
  | { type: 'chat_closed'; chatId: number }
  | { type: 'operators_offline' };

interface WidgetWsState {
  chatId: number | null;
  messages: WidgetMessage[];
  isTyping: boolean;
  operatorsOffline: boolean;
  chatClosed: boolean;
  connected: boolean;
}

interface WidgetWsActions {
  sendMessage: (content: string) => void;
  closeChat: () => void;
  uploadFile: (file: File) => Promise<void>;
  sendTypingStart: () => void;
  sendTypingStop: () => void;
  openWidget: () => void;
  resetChat: () => void;
}

const STORAGE_KEY = 'activeChatId';
let optimisticIdCounter = -1;

export function useWidgetWs(): WidgetWsState & WidgetWsActions {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const intentionalCloseRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInitRef = useRef(false);

  const [state, setState] = useState<WidgetWsState>(() => {
    const storedId = localStorage.getItem(STORAGE_KEY);
    return {
      chatId: storedId ? Number(storedId) : null,
      messages: [],
      isTyping: false,
      operatorsOffline: false,
      chatClosed: false,
      connected: false,
    };
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchMessages = useCallback(async (chatId: number) => {
    try {
      const res = await fetch(`/messages/${chatId}`);
      if (!res.ok) {
        if (res.status === 404) {
          localStorage.removeItem(STORAGE_KEY);
          setState((s) => ({ ...s, chatId: null, chatClosed: false }));
        }
        return;
      }
      const data: WidgetMessage[] = await res.json();
      setState((s) => ({ ...s, messages: data.filter((m) => m.message_type !== 'note') }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectDelayRef.current = 1000;
      setState((s) => ({ ...s, connected: true }));

      const chatId = localStorage.getItem(STORAGE_KEY);
      if (chatId) {
        ws.send(JSON.stringify({ type: 'join_chat', chatId: Number(chatId) }));
        fetchMessages(Number(chatId));
      } else if (pendingInitRef.current) {
        pendingInitRef.current = false;
        ws.send(JSON.stringify({ type: 'init_chat' }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: WsInMsg = JSON.parse(event.data);
        handleWsMessage(data);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      if (intentionalCloseRef.current) return;
      setTimeout(() => {
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
        connect();
      }, reconnectDelayRef.current);
    };

    ws.onerror = () => {};
  }, [fetchMessages]);

  const handleWsMessage = useCallback((data: WsInMsg) => {
    switch (data.type) {
      case 'chat_created':
        localStorage.setItem(STORAGE_KEY, String(data.chatId));
        setState((s) => ({
          ...s,
          chatId: data.chatId,
          messages: [],
          chatClosed: false,
          operatorsOffline: false,
        }));
        break;

      case 'message': {
        const msg = data.message;
        if (msg.message_type === 'note') break;
        setState((s) => {
          if (String(msg.chat_id) !== String(s.chatId)) return s;
          const exists = s.messages.some((m) => m.id === msg.id && m.id > 0);
          if (exists) return s;
          const withoutOptimistic = s.messages.filter((m) => m.id > 0 || m.content !== msg.content || m.sender_id !== msg.sender_id);
          return { ...s, messages: [...withoutOptimistic, msg] };
        });
        break;
      }

      case 'typingStart':
        setState((s) => {
          if (String(data.chatId) !== String(s.chatId)) return s;
          return { ...s, isTyping: true };
        });
        break;

      case 'typingStop':
        setState((s) => {
          if (String(data.chatId) !== String(s.chatId)) return s;
          return { ...s, isTyping: false };
        });
        break;

      case 'chat_closed':
        localStorage.removeItem(STORAGE_KEY);
        setState((s) => ({
          ...s,
          chatClosed: true,
          chatId: s.chatId,
        }));
        break;

      case 'operators_offline':
        setState((s) => ({ ...s, operatorsOffline: true }));
        break;
    }
  }, []);

  const checkChatStatus = useCallback(async (chatId: number) => {
    try {
      const res = await fetch(`/chat-status/${chatId}`);
      const data = await res.json();
      if (data.status === 'closed' || data.status === 'not_found') {
        localStorage.removeItem(STORAGE_KEY);
        setState((s) => ({ ...s, chatId: null, chatClosed: true }));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const openWidget = useCallback(() => {
    const chatId = localStorage.getItem(STORAGE_KEY);
    if (chatId) {
      checkChatStatus(Number(chatId));
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      pendingInitRef.current = !chatId;
      connect();
      return;
    }

    if (!chatId) {
      wsRef.current.send(JSON.stringify({ type: 'init_chat' }));
    } else {
      wsRef.current.send(JSON.stringify({ type: 'join_chat', chatId: Number(chatId) }));
      fetchMessages(Number(chatId));
    }
  }, [connect, checkChatStatus, fetchMessages]);

  const resetChat = useCallback(() => {
    setState((s) => ({
      ...s,
      chatId: null,
      chatClosed: false,
      messages: [],
      isTyping: false,
      operatorsOffline: false,
    }));
  }, []);

  const sendMessage = useCallback((content: string) => {
    const chatId = stateRef.current.chatId;
    if (!chatId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const optimisticMsg: WidgetMessage = {
      id: optimisticIdCounter--,
      chat_id: chatId,
      sender_id: 0,
      sender_name: 'Клиент',
      content,
      message_type: 'text',
      created_at: Date.now(),
    };
    setState((s) => ({ ...s, messages: [...s.messages, optimisticMsg] }));

    wsRef.current.send(JSON.stringify({ type: 'message', chatId, content }));
  }, []);

  const closeChat = useCallback(() => {
    const chatId = stateRef.current.chatId;
    if (!chatId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'close_chat', chatId }));
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const chatId = stateRef.current.chatId;
    if (!chatId) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/upload/${chatId}`, { method: 'POST', body: formData });
      if (!res.ok) return;
      const msg: WidgetMessage = await res.json();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'file_message', chatId, msg }));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const sendTypingStart = useCallback(() => {
    const chatId = stateRef.current.chatId;
    if (!chatId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    wsRef.current.send(JSON.stringify({ type: 'typingStart', chatId }));
    typingTimeoutRef.current = setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'typingStop', chatId }));
      }
    }, 1000);
  }, []);

  const sendTypingStop = useCallback(() => {
    const chatId = stateRef.current.chatId;
    if (!chatId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    wsRef.current.send(JSON.stringify({ type: 'typingStop', chatId }));
  }, []);

  useEffect(() => {
    const storedId = localStorage.getItem(STORAGE_KEY);
    if (storedId) {
      checkChatStatus(Number(storedId));
      connect();
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const newId = e.newValue ? Number(e.newValue) : null;
        setState((s) => ({ ...s, chatId: newId }));
        if (newId && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'join_chat', chatId: newId }));
          fetchMessages(newId);
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, [connect, checkChatStatus, fetchMessages]);

  return {
    ...state,
    sendMessage,
    closeChat,
    uploadFile,
    sendTypingStart,
    sendTypingStop,
    openWidget,
    resetChat,
  };
}
