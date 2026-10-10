import api from './api';
import type {
  Chat,
  Message,
  Tag,
  CannedResponse,
  Stats,
  DailyStat,
  Operator,
  OperatorStats,
  AdminChat,
  InviteCode,
  InviteBatch,
  Settings,
  Tenant,
  CrmDashboard,
  TelegramBot,
} from '@/types';

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string }>('/login', { email, password }),
  register: (data: { name: string; email: string; password: string; inviteCode: string }) =>
    api.post<{ token: string }>('/register', data),
};

export const chatApi = {
  getChats: (params?: { status?: string; tagId?: number | number[]; from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get<Chat[]>('/chats', { params }),
  getMessages: (chatId: number) =>
    api.get<Message[]>(`/messages/${chatId}`),
  getChatStatus: (chatId: number) =>
    api.get<{ status: string }>(`/chat-status/${chatId}`),
  addTag: (chatId: number, tagId: number) =>
    api.put<{ ok: boolean }>(`/chats/${chatId}/tag`, { tagId }),
  removeTag: (chatId: number, tagId: number) =>
    api.delete(`/chats/${chatId}/tag/${tagId}`),
  uploadFile: (chatId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/upload/${chatId}`, formData);
  },
  rateChat: (chatId: number, rating: number) =>
    api.post<{ ok: boolean }>(`/rate/${chatId}`, { rating }),
};

export const statsApi = {
  getStats: () => api.get<Stats>('/stats'),
  getDaily: () => api.get<DailyStat[]>('/stats/daily'),
};

export const cannedApi = {
  getAll: () => api.get<CannedResponse[]>('/canned-responses'),
  create: (data: { shortcut: string; title: string; content: string }) =>
    api.post<CannedResponse>('/canned-responses', data),
  update: (id: number, data: { shortcut?: string; title?: string; content?: string }) =>
    api.put<CannedResponse>(`/canned-responses/${id}`, data),
  delete: (id: number) =>
    api.delete(`/canned-responses/${id}`),
};

export const adminApi = {
  getOperators: (tenantId?: number) =>
    api.get<Operator[]>('/admin/operators', { params: tenantId ? { tenantId } : undefined }),
  toggleOperator: (id: number) =>
    api.put<Operator>(`/admin/operators/${id}/toggle`),
  changeRole: (id: number, role: string) =>
    api.put<Operator>(`/admin/operators/${id}/role`, { role }),
  deleteOperator: (id: number) =>
    api.delete(`/admin/operators/${id}`),
  getOperatorStats: (tenantId?: number) =>
    api.get<OperatorStats[]>('/admin/operator-stats', { params: tenantId ? { tenantId } : undefined }),
  getChats: (params?: { status?: string; operator_id?: number; from?: string; to?: string; limit?: number; offset?: number; tenantId?: number }) =>
    api.get<AdminChat[]>('/admin/chats', { params }),
  getTags: (tenantId?: number) =>
    api.get<Tag[]>('/admin/tags', { params: tenantId ? { tenantId } : undefined }),
  createTag: (data: { name: string; color?: string }, tenantId?: number) =>
    api.post<Tag>('/admin/tags', tenantId ? { ...data, tenantId } : data),
  deleteTag: (id: number) =>
    api.delete(`/admin/tags/${id}`),
  getInvites: (tenantId?: number) =>
    api.get<InviteCode[]>('/admin/invite-codes', { params: tenantId ? { tenantId } : undefined }),
  createInvite: (expiresInHours?: number, count = 1, tenantId?: number) =>
    api.post<InviteBatch>('/admin/invite-codes', { expiresInHours: expiresInHours || null, count, ...(tenantId ? { tenantId } : {}) }),
  deleteInvite: (id: number) =>
    api.delete(`/admin/invite-codes/${id}`),
  getSettings: (tenantId?: number) =>
    api.get<Settings>('/admin/settings', { params: tenantId ? { tenantId } : undefined }),
  saveSettings: (data: Partial<Settings>, tenantId?: number) =>
    api.put<Settings>('/admin/settings', tenantId ? { ...data, tenantId } : data),
  getTelegramBot: (tenantId?: number) =>
    api.get<{ bot: TelegramBot | null; webhook_url: string | null }>('/admin/telegram-bot', { params: tenantId ? { tenantId } : undefined }),
  connectTelegramBot: (bot_token: string, tenantId?: number) =>
    api.put<{ bot: TelegramBot; webhook_url: string | null; webhook_registered: boolean; webhook_error: string | null }>('/admin/telegram-bot', tenantId ? { bot_token, tenantId } : { bot_token }),
  toggleTelegramBot: (is_active: boolean, tenantId?: number) =>
    api.put<{ bot: TelegramBot }>('/admin/telegram-bot/toggle', tenantId ? { is_active, tenantId } : { is_active }),
  disconnectTelegramBot: (tenantId?: number) =>
    api.delete('/admin/telegram-bot', { params: tenantId ? { tenantId } : undefined }),
};

export const superadminApi = {
  getTenants: () => api.get<Tenant[]>('/superadmin/tenants'),
  createTenant: (data: { name: string; slug: string }) =>
    api.post<Tenant>('/superadmin/tenants', data),
  updateTenant: (id: number, data: { name?: string; operator_limit?: number | null }) =>
    api.put<Tenant>(`/superadmin/tenants/${id}`, data),
  setTenantStatus: (id: number, status: 'active' | 'suspended') =>
    api.put<Tenant>(`/superadmin/tenants/${id}/status`, { status }),
  deleteTenant: (id: number) =>
    api.delete<{ ok: boolean; id: number; name: string; slug: string }>(`/superadmin/tenants/${id}`),
  issueInvites: (id: number, data: { count: number; expiresInHours?: number }) =>
    api.post<InviteBatch>(`/superadmin/tenants/${id}/invites`, data),
  getDashboard: () => api.get<CrmDashboard>('/superadmin/dashboard'),
  getTelegramBots: () => api.get<TelegramBot[]>('/superadmin/telegram-bots'),
};
