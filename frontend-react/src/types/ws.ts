export type WsIncomingMessage =
  | { type: 'auth_ok' }
  | { type: 'auth_error' }
  | { type: 'init_operator'; chats: { id: number; client_name?: string | null; updated_at: number; source?: string }[] }
  | { type: 'new_chat'; chatId: number; client_name?: string | null; updated_at: number; source?: string }
  | { type: 'chat_created'; chatId: number }
  | { type: 'message'; message: import('.').Message; updated_at: number }
  | { type: 'typingStart'; chatId: number; senderId: number }
  | { type: 'typingStop'; chatId: number; senderId: number }
  | { type: 'messageRead'; chatId: number; messageId: number; readerId: number }
  | { type: 'chat_closed'; chatId: number; reason?: string }
  | { type: 'operators_status'; operators: import('.').OnlineOperator[] }
  | { type: 'chat_transferred'; chatId: number }
  | { type: 'operators_offline' };

export type WsOutgoingMessage =
  | { type: 'auth'; token: string }
  | { type: 'operator_join' }
  | { type: 'operator_status'; status: string }
  | { type: 'join_chat'; chatId: number }
  | { type: 'message'; chatId: number; content: string; message_type?: string }
  | { type: 'typingStart'; chatId: number }
  | { type: 'typingStop'; chatId: number }
  | { type: 'messageRead'; chatId: number; messageId: number }
  | { type: 'close_chat'; chatId: number }
  | { type: 'transfer_chat'; chatId: number; targetOperatorId: number };
