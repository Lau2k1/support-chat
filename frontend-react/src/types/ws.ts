export type WsIncomingMessage =
  | { type: 'auth_ok' }
  | { type: 'auth_error' }
  | { type: 'init_operator'; chats: { id: number; public_code?: string; client_name?: string | null; updated_at: number; source?: string; assigned_operator_id?: number | null; operator_name?: string | null }[] }
  | { type: 'new_chat'; chatId: number; public_code?: string; client_name?: string | null; updated_at: number; source?: string; assigned_operator_id?: number | null; operator_name?: string | null }
  | { type: 'chat_created'; chatId: number; public_code?: string }
  | { type: 'message'; message: import('.').Message; updated_at: number }
  | { type: 'typingStart'; chatId: number; senderId: number }
  | { type: 'typingStop'; chatId: number; senderId: number }
  | { type: 'messageRead'; chatId: number; messageId: number; readerId: number }
  | { type: 'chat_closed'; chatId: number; reason?: string }
  | { type: 'operators_status'; operators: import('.').OnlineOperator[] }
  | { type: 'chat_transferred'; chatId: number }
  | { type: 'chat_assigned'; chatId: number; operatorId: number; operatorName: string }
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
