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
  Settings,
  Tenant,
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
  getOperators: () => api.get<Operator[]>('/admin/operators'),
  toggleOperator: (id: number) =>
    api.put<Operator>(`/admin/operators/${id}/toggle`),
  changeRole: (id: number, role: string) =>
    api.put<Operator>(`/admin/operators/${id}/role`, { role }),
  deleteOperator: (id: number) =>
    api.delete(`/admin/operators/${id}`),
  getOperatorStats: () => api.get<OperatorStats[]>('/admin/operator-stats'),
  getChats: (params?: { status?: string; operator_id?: number; from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get<AdminChat[]>('/admin/chats', { params }),
  getTags: () => api.get<Tag[]>('/admin/tags'),
  createTag: (data: { name: string; color?: string }) =>
    api.post<Tag>('/admin/tags', data),
  deleteTag: (id: number) =>
    api.delete(`/admin/tags/${id}`),
  getInvites: () => api.get<InviteCode[]>('/admin/invite-codes'),
  createInvite: (expiresInHours?: number) =>
    api.post<InviteCode>('/admin/invite-codes', { expiresInHours: expiresInHours || null }),
  deleteInvite: (id: number) =>
    api.delete(`/admin/invite-codes/${id}`),
  getSettings: () => api.get<Settings>('/admin/settings'),
  saveSettings: (data: Partial<Settings>) =>
    api.put<Settings>('/admin/settings', data),
};

export const superadminApi = {
  getTenants: () => api.get<Tenant[]>('/superadmin/tenants'),
  createTenant: (data: { name: string; slug: string }) =>
    api.post<Tenant>('/superadmin/tenants', data),
  setTenantStatus: (id: number, status: 'active' | 'suspended') =>
    api.put<Tenant>(`/superadmin/tenants/${id}/status`, { status }),
};
