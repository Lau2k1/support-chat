import { WebSocket } from 'ws';

export interface OperatorPayload {
  id: number;
  name: string;
  role: string;
  /** Superadmin has no tenant (null). */
  tenantId: number | null;
}

export interface ClientWs extends WebSocket {
  role?: 'operator' | 'client';
  operator?: OperatorPayload;
  operatorStatus?: string;
  chatId?: number;
}

export type IncomingMessage =
  | { type: 'auth'; token: string }
  | { type: 'operator_join' }
  | { type: 'init_chat'; tenant?: string }
  | { type: 'join_chat'; chatId: number | string; token?: string }
  | { type: 'message'; chatId: number | string; content: string; message_type?: string }
  | { type: 'typingStart'; chatId: number | string }
  | { type: 'typingStop'; chatId: number | string }
  | { type: 'messageRead'; chatId: number | string; messageId: number | string }
  | { type: 'close_chat'; chatId: number | string }
  | { type: 'operator_status'; status: string }
  | { type: 'transfer_chat'; chatId: number | string; targetOperatorId: number };

export type OutgoingMessage =
  | { type: 'auth_error' }
  | { type: 'auth_ok' }
  | { type: 'init_operator'; chats: ChatRow[] }
  | { type: 'new_chat'; chatId: number; public_code?: string; client_name?: string | null; updated_at: number; source?: string; assigned_operator_id?: number | null; operator_name?: string | null }
  | { type: 'chat_created'; chatId: number; token: string; public_code?: string }
  | { type: 'chat_error'; chatId?: number; error: string }
  | { type: 'message'; message: MessageRow & { sender_name: string }; updated_at: number }
  | { type: 'typingStart'; chatId: number; senderId: number }
  | { type: 'typingStop'; chatId: number; senderId: number }
  | { type: 'messageRead'; chatId: number; messageId: number; readerId: number }
  | { type: 'chat_closed'; chatId: number; reason?: string }
  | { type: 'operators_status'; operators: { id: number; name: string; status: 'online' | 'busy' | 'offline' }[] }
  | { type: 'chat_transferred'; chatId: number }
  | { type: 'chat_assigned'; chatId: number; operatorId: number; operatorName: string }
  | { type: 'operators_offline' };

export interface ChatRow {
  id: number;
  /** Collision-free public code: "<project>_<chatId>". */
  public_code?: string;
  /** Client display name (Telegram profile name for telegram-sourced chats). */
  client_name?: string | null;
  updated_at: number;
  source?: string;
  assigned_operator_id?: number | null;
  operator_name?: string | null;
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