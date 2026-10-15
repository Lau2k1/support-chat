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
  BillingOverview,
  PromoQuote,
  Plan,
  CheckoutResult,
  Payment,
  CrmPayment,
  PromoCode,
  PromoInput,
  TicketTemplateListResponse,
  TicketTemplateResponse,
  TicketTemplateSchema,
  TicketListResponse,
  TicketResponse,
  TicketStatus,
  SystemStatus,
  SystemAlertsResponse,
  TelegramWidgetData,
  TelegramLoginConfig,
  TelegramLinkState,
  WidgetInfo,
} from '@/types';

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string }>('/login', { email, password }),
  /** Without inviteCode → self-signup admin (creates a new tenant); with it → operator. */
  register: (data: {
    name: string;
    email: string;
    password: string;
    inviteCode?: string;
    company?: string;
    /** Акцепт Публичной оферты и Политики — без него аккаунт не создаётся. */
    acceptOffer: boolean;
    /** Согласие на обработку персональных данных (ст. 9 ФЗ-152). */
    acceptConsent: boolean;
    /** Необязательное согласие на информационные и маркетинговые сообщения. */
    marketingConsent?: boolean;
    /**
     * Заявленная цель приобретения (оферта, разд. 12): `business` — для поддержки
     * своих клиентов, `consumer` — для личных нужд (тогда применяется Приложение № 2).
     * Для самостоятельной регистрации обязателен.
     */
    clientType?: 'business' | 'consumer';
  }) => api.post<{ token: string; role: string }>('/register', data),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ token: string }>('/me/password', { currentPassword, newPassword }),

  // Telegram login (Login Widget). The payload is signed by Telegram and verified
  // on the server with the bot token.
  telegramConfig: () => api.get<TelegramLoginConfig>('/auth/telegram/config'),
  telegramLogin: (data: TelegramWidgetData) =>
    api.post<{ token: string; role: string; tenantId: number | null; registered: boolean }>(
      '/auth/telegram/login',
      data
    ),
  linkTelegram: (data: TelegramWidgetData) =>
    api.post<{ ok: boolean; telegram: TelegramLinkState }>('/me/telegram/link', data),
  unlinkTelegram: () => api.post<{ ok: boolean; telegram: TelegramLinkState }>('/me/telegram/unlink'),
};

export const billingApi = {
  get: () => api.get<BillingOverview>('/billing'),
  validatePromo: (code: string, planCode: string) =>
    api.post<PromoQuote>('/billing/promo/validate', { code, planCode }),
  checkout: (planCode: string, promoCode?: string) =>
    api.post<CheckoutResult>('/billing/checkout', { planCode, promoCode: promoCode || undefined }),
  syncPayment: (id: number) =>
    api.post<{ status: Payment['status'] }>(`/billing/payments/${id}/sync`),
  cancelPayment: (id: number) =>
    api.post<{ ok: boolean }>(`/billing/payments/${id}/cancel`),
};

export const chatApi = {
  getChats: (params?: { status?: string; tagId?: number | number[]; from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get<Chat[]>('/chats', { params }),
  getMessages: (chatId: number) =>
    api.get<Message[]>(`/messages/${chatId}`),
  getTags: () =>
    api.get<Tag[]>('/tags'),
  getChatTags: (chatId: number) =>
    api.get<Tag[]>(`/chats/${chatId}/tags`),
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
  create: (data: { shortcut?: string; title: string; content: string; category?: string }) =>
    api.post<CannedResponse>('/canned-responses', data),
  update: (id: number, data: { shortcut?: string; title?: string; content?: string; category?: string }) =>
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
  updateTag: (id: number, data: { name: string; color?: string }) =>
    api.put<Tag>(`/admin/tags/${id}`, data),
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
    api.get<{ bot: TelegramBot | null; webhook_configured: boolean }>('/admin/telegram-bot', { params: tenantId ? { tenantId } : undefined }),
  connectTelegramBot: (bot_token: string, tenantId?: number) =>
    api.put<{ bot: TelegramBot; webhook_registered: boolean; webhook_error: string | null }>('/admin/telegram-bot', tenantId ? { bot_token, tenantId } : { bot_token }),
  toggleTelegramBot: (is_active: boolean, tenantId?: number) =>
    api.put<{ bot: TelegramBot }>('/admin/telegram-bot/toggle', tenantId ? { is_active, tenantId } : { is_active }),
  disconnectTelegramBot: (tenantId?: number) =>
    api.delete('/admin/telegram-bot', { params: tenantId ? { tenantId } : undefined }),
  getWidget: (tenantId?: number) =>
    api.get<WidgetInfo>('/admin/widget', { params: tenantId ? { tenantId } : undefined }),
};

export const superadminApi = {
  getTenants: () => api.get<Tenant[]>('/superadmin/tenants'),
  createTenant: (data: { name: string; slug: string }) =>
    api.post<Tenant>('/superadmin/tenants', data),
  updateTenant: (id: number, data: { name?: string; operator_limit?: number | null }) =>
    api.put<Tenant>(`/superadmin/tenants/${id}`, data),
  setTenantStatus: (id: number, status: 'active' | 'suspended') =>
    api.put<Tenant>(`/superadmin/tenants/${id}/status`, { status }),
  /** Plan catalog for the CRM (assigning plans to clients by hand). */
  getPlans: () => api.get<Plan[]>('/superadmin/plans'),
  /**
   * Manual subscription change. Only the fields you send are touched:
   * `planCode` (null снимает тариф), `paidUntil` (null = бессрочно),
   * `billingStatus`, `operatorLimit`.
   */
  updateTenantSubscription: (
    id: number,
    data: {
      planCode?: string | null;
      paidUntil?: string | null;
      billingStatus?: 'active' | 'unpaid';
      operatorLimit?: number | null;
    }
  ) => api.put<Tenant>(`/superadmin/tenants/${id}/subscription`, data),
  deleteTenant: (id: number) =>
    api.delete<{ ok: boolean; id: number; name: string; slug: string }>(`/superadmin/tenants/${id}`),
  issueInvites: (id: number, data: { count: number; expiresInHours?: number }) =>
    api.post<InviteBatch>(`/superadmin/tenants/${id}/invites`, data),
  getDashboard: () => api.get<CrmDashboard>('/superadmin/dashboard'),
  getTelegramBots: () => api.get<TelegramBot[]>('/superadmin/telegram-bots'),

  // Billing: payments + manual confirmation.
  getPayments: () => api.get<CrmPayment[]>('/superadmin/payments'),
  confirmPayment: (id: number) =>
    api.post<{ ok: boolean; alreadyPaid?: boolean }>(`/superadmin/payments/${id}/confirm`),
  cancelPayment: (id: number) =>
    api.post<{ ok: boolean }>(`/superadmin/payments/${id}/cancel`),

  // Promo codes.
  getPromoCodes: () => api.get<PromoCode[]>('/superadmin/promo-codes'),
  createPromoCode: (data: PromoInput) =>
    api.post<PromoCode>('/superadmin/promo-codes', data),
  updatePromoCode: (id: number, data: PromoInput) =>
    api.put<PromoCode>(`/superadmin/promo-codes/${id}`, data),
  deletePromoCode: (id: number) =>
    api.delete<{ ok: boolean }>(`/superadmin/promo-codes/${id}`),

  // Platform health (owner CRM).
  getSystemStatus: () => api.get<SystemStatus>('/superadmin/system/status'),
  getSystemAlerts: (limit = 50) =>
    api.get<SystemAlertsResponse>('/superadmin/system/alerts', { params: { limit } }),
};

export const ticketTemplatesApi = {
  list: () => api.get<TicketTemplateListResponse>('/ticket-templates'),
  get: (id: number) => api.get<TicketTemplateResponse>(`/ticket-templates/${id}`),
  create: (data: { name: string; description?: string | null; schema: TicketTemplateSchema; isActive?: boolean }) =>
    api.post<TicketTemplateResponse>('/ticket-templates', data),
  update: (
    id: number,
    data: { name?: string; description?: string | null; schema?: TicketTemplateSchema; isActive?: boolean }
  ) => api.put<TicketTemplateResponse>(`/ticket-templates/${id}`, data),
  delete: (id: number) => api.delete<{ success: boolean }>(`/ticket-templates/${id}`),
};

export const ticketsApi = {
  list: (params?: { status?: TicketStatus; templateId?: number }) =>
    api.get<TicketListResponse>('/tickets', { params }),
  get: (id: number) => api.get<TicketResponse>(`/tickets/${id}`),
  /** Operator/admin fills an active template and creates a ticket. */
  create: (data: { templateId: number; data: Record<string, any> }) =>
    api.post<TicketResponse>('/tickets', data),
  /** Решено / не решено. */
  setStatus: (id: number, status: TicketStatus) =>
    api.put<TicketResponse>(`/tickets/${id}`, { status }),
  remove: (id: number) => api.delete<{ success: boolean }>(`/tickets/${id}`),
};
