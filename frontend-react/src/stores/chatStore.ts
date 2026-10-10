import { create } from 'zustand';
import type { Message, OnlineOperator, Tag, CannedResponse } from '@/types';

interface ChatState {
  currentChatId: number | null;
  openTabs: number[];
  messages: Record<string, Message[]>;
  chatTimers: Record<string, number>;
  chatUnread: Record<string, number>;
  chatPreviews: Record<string, string>;
  chatSources: Record<string, string>;
  chatNames: Record<string, string>;
  typingChatIds: Set<number>;
  onlineOperators: OnlineOperator[];
  allTags: Tag[];
  cannedResponses: CannedResponse[];
  operatorStatus: 'online' | 'busy' | 'offline';
  noteMode: boolean;

  setCurrentChat: (id: number | null) => void;
  addTab: (id: number) => void;
  removeTab: (id: number) => void;
  setMessages: (chatId: string, messages: Message[]) => void;
  addMessage: (chatId: string, message: Message) => void;
  setChatTimer: (chatId: string, updatedAt: number) => void;
  setUnread: (chatId: string, count: number) => void;
  incrementUnread: (chatId: string) => void;
  setPreview: (chatId: string, preview: string) => void;
  setChatSource: (chatId: string, source: string) => void;
  setChatName: (chatId: string, name: string) => void;
  setTyping: (chatId: number, isTyping: boolean) => void;
  setOnlineOperators: (operators: OnlineOperator[]) => void;
  setAllTags: (tags: Tag[]) => void;
  setCannedResponses: (responses: CannedResponse[]) => void;
  setOperatorStatus: (status: 'online' | 'busy' | 'offline') => void;
  setNoteMode: (mode: boolean) => void;
  removeChat: (chatId: number) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentChatId: null,
  openTabs: [],
  messages: {},
  chatTimers: {},
  chatUnread: {},
  chatPreviews: {},
  chatSources: {},
  chatNames: {},
  typingChatIds: new Set<number>(),
  onlineOperators: [],
  allTags: [],
  cannedResponses: [],
  operatorStatus: 'online',
  noteMode: false,

  setCurrentChat: (id) => set({ currentChatId: id }),

  addTab: (id) => {
    const tabs = get().openTabs;
    if (!tabs.includes(id)) {
      set({ openTabs: [...tabs, id] });
    }
  },

  removeTab: (id) => {
    const { openTabs, currentChatId } = get();
    const newTabs = openTabs.filter((t) => t !== id);
    let newCurrent = currentChatId;
    if (currentChatId === id) {
      newCurrent = newTabs.length ? newTabs[newTabs.length - 1] : null;
    }
    set({ openTabs: newTabs, currentChatId: newCurrent });
  },

  setMessages: (chatId, messages) =>
    set((s) => ({ messages: { ...s.messages, [chatId]: messages } })),

  addMessage: (chatId, message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: [...(s.messages[chatId] || []), message],
      },
    })),

  setChatTimer: (chatId, updatedAt) =>
    set((s) => ({ chatTimers: { ...s.chatTimers, [chatId]: updatedAt } })),

  setUnread: (chatId, count) =>
    set((s) => ({ chatUnread: { ...s.chatUnread, [chatId]: count } })),

  incrementUnread: (chatId) =>
    set((s) => ({
      chatUnread: { ...s.chatUnread, [chatId]: (s.chatUnread[chatId] || 0) + 1 },
    })),

  setPreview: (chatId, preview) =>
    set((s) => ({ chatPreviews: { ...s.chatPreviews, [chatId]: preview } })),

  setChatSource: (chatId, source) =>
    set((s) => ({ chatSources: { ...s.chatSources, [chatId]: source } })),

  setChatName: (chatId, name) =>
    set((s) => ({ chatNames: { ...s.chatNames, [chatId]: name } })),

  setTyping: (chatId, isTyping) =>
    set((s) => {
      const next = new Set(s.typingChatIds);
      if (isTyping) next.add(chatId); else next.delete(chatId);
      return { typingChatIds: next };
    }),

  setOnlineOperators: (operators) => set({ onlineOperators: operators }),

  setAllTags: (tags) => set({ allTags: tags }),

  setCannedResponses: (responses) => set({ cannedResponses: responses }),

  setOperatorStatus: (status) => set({ operatorStatus: status }),

  setNoteMode: (mode) => set({ noteMode: mode }),

  removeChat: (chatId) =>
    set((s) => {
      const { [String(chatId)]: _, ...restMessages } = s.messages;
      const { [String(chatId)]: __, ...restTimers } = s.chatTimers;
      const { [String(chatId)]: ___, ...restUnread } = s.chatUnread;
      const { [String(chatId)]: ____, ...restPreviews } = s.chatPreviews;
      const { [String(chatId)]: _____, ...restSources } = s.chatSources;
      const { [String(chatId)]: ______, ...restNames } = s.chatNames;
      return {
        messages: restMessages,
        chatTimers: restTimers,
        chatUnread: restUnread,
        chatPreviews: restPreviews,
        chatSources: restSources,
        chatNames: restNames,
      };
    }),
}));
