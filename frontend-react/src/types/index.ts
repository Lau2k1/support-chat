export interface JwtPayload {
  id: number;
  name: string;
  role: 'superadmin' | 'admin' | 'operator';
  tid?: number | null;
  exp?: number;
}

export interface Tenant {
  id: number;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  created_at?: string;
  operator_limit?: number | null;
  operators_count?: number;
  chats_count?: number;
  open_chats?: number;
  messages_count?: number;
  invites_issued?: number;
  invites_used?: number;
  avg_rating?: number;
}

export interface InviteBatch {
  tenant_id: number;
  codes: string[];
  count: number;
}

export interface CrmDashboard {
  tenants: number;
  active_tenants: number;
  operators: number;
  chats: number;
  open_chats: number;
  messages: number;
  invites: number;
  invites_used: number;
  avg_rating: number;
  daily: { day: string; count: number }[];
}

export interface Operator {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'operator';
  is_enabled: boolean;
  status?: string;
  created_at?: string;
}

export interface Chat {
  id: number;
  client_id: number;
  client_name?: string;
  client_device?: string;
  client_region?: string;
  status: 'open' | 'closed';
  rating?: number;
  assigned_operator_id?: number;
  operator_name?: string;
  created_at: number;
  updated_at: number;
  messages_count?: number;
  tags: Tag[];
}

export interface Message {
  id: number;
  chat_id: number;
  sender_id: number;
  sender_name?: string;
  content: string;
  message_type: 'text' | 'image' | 'file' | 'note';
  file_url?: string | null;
  created_at: number;
  read_at?: string | null;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  created_at?: string;
}

export interface CannedResponse {
  id: number;
  shortcut: string;
  title: string;
  content: string;
}

export interface InviteCode {
  id: number;
  code: string;
  created_by?: number;
  created_by_name?: string;
  used_by?: number;
  used_by_name?: string;
  used_at?: string;
  expires_at?: string;
  created_at: string;
}

export interface Settings {
  chat_timeout_minutes: string;
  welcome_message: string;
}

export interface Stats {
  totalChats: number;
  openChats: number;
  closedChats: number;
  totalMessages: number;
  avgResponseSec: number;
  avgRating: number;
}

export interface DailyStat {
  day: string;
  count: number;
}

export interface OperatorStats {
  id: number;
  name: string;
  email: string;
  role: string;
  is_enabled: boolean;
  total_chats: number;
  total_messages: number;
  avg_response_sec: number;
  avg_rating: number;
}

export interface AdminChat {
  id: number;
  client_id: number;
  status: 'open' | 'closed';
  rating?: number;
  assigned_operator_id?: number;
  operator_name?: string;
  created_at: number;
  updated_at: number;
  messages_count: number;
}

export interface OnlineOperator {
  id: number;
  name: string;
}

export interface ArchiveFilters {
  status: string;
  from: string;
  to: string;
  tagIds: number[];
}
