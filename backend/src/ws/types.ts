import { WebSocket } from 'ws';

export interface OperatorPayload {
  id: number;
  name: string;
}

export interface ClientWs extends WebSocket {
  role?: 'operator' | 'client';
  operator?: OperatorPayload;
  chatId?: number;
}

export type IncomingMessage =
  | { type: 'auth'; token: string }
  | { type: 'operator_join' }
  | { type: 'init_chat' }
  | { type: 'join_chat'; chatId: number | string }
  | { type: 'message'; chatId: number | string; content: string }
  | { type: 'typingStart'; chatId: number | string }
  | { type: 'typingStop'; chatId: number | string }
  | { type: 'messageRead'; chatId: number | string; messageId: number | string }
  | { type: 'close_chat'; chatId: number | string };

export type OutgoingMessage =
  | { type: 'auth_error' }
  | { type: 'init_operator'; chats: ChatRow[] }
  | { type: 'new_chat'; chatId: number; updated_at: number }
  | { type: 'chat_created'; chatId: number }
  | { type: 'message'; message: MessageRow & { sender_name: string }; updated_at: number }
  | { type: 'typingStart'; chatId: number; senderId: number }
  | { type: 'typingStop'; chatId: number; senderId: number }
  | { type: 'messageRead'; chatId: number; messageId: number; readerId: number }
  | { type: 'chat_closed'; chatId: number; reason?: string };

export interface ChatRow {
  id: number;
  updated_at: number;
}

export interface MessageRow {
  id: number;
  chat_id: number;
  sender_id: number;
  content: string;
  message_type?: string;
  file_url?: string | null;
  created_at: number;
  sender_name?: string;
}
