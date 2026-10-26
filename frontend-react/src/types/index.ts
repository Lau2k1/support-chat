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
  billing_status?: 'active' | 'unpaid';
  plan_id?: number | null;
  plan_code?: string | null;
  plan_name?: string | null;
  paid_until?: string | null;
  created_at?: string;
  operator_limit?: number | null;
  operators_count?: number;
  chats_count?: number;
  open_chats?: number;
  messages_count?: number;
  invites_issued?: number;
  invites_used?: number;
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
  daily: { day: string; count: number }[];
}

export interface TelegramBot {
  id: number;
  tenant_id?: number;
  tenant_name?: string;
  tenant_slug?: string;
  bot_username?: string | null;
  is_active: boolean;
  created_at?: string;
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
  public_code?: string;
  client_name?: string;
  status: 'open' | 'closed';
  assigned_operator_id?: number;
  operator_name?: string;
  created_at: number;
  updated_at: number;
  messages_count?: number;
  source?: 'widget' | 'telegram';
  external_id?: string | null;
  tags: Tag[];
}

export interface Message {
  id: number;
  chat_id: number;
  sender_id: number;
  sender_name?: string;
  content: string;
  message_type: 'text' | 'image' | 'video' | 'file' | 'note';
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
  /** Quick-replies group. Empty string = "Без категории". */
  category: string;
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
  /** SEC-19: origins allowed to iframe-embed the widget (JSON array of URLs). */
  widget_origins?: string;
}

/** Данные раздела «Виджет»: slug тенанта и готовый адрес встраивания. */
export interface WidgetInfo {
  slug: string;
  widgetUrl: string;
  /** Домены, которым разрешено встраивание (пусто = только сам виджет). */
  origins: string[];
}

export interface Stats {
  totalChats: number;
  openChats: number;
  closedChats: number;
  totalMessages: number;
  avgResponseSec: number;
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
}

export interface AdminChat {
  id: number;
  client_id: number;
  public_code?: string;
  status: 'open' | 'closed';
  assigned_operator_id?: number;
  operator_name?: string;
  /** Имя из Telegram-профиля; у виджет-чатов его нет. */
  client_name?: string | null;
  source?: 'widget' | 'telegram';
  created_at: number;
  updated_at: number;
  messages_count: number;
}

export type TicketFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'file'
  | 'divider'
  | 'title';

export type TicketPriority = 'low' | 'normal' | 'high';

export type ConditionOperator = 'eq' | 'neq' | 'in' | 'notEmpty' | 'empty';

/** Правило показа поля: зависит от значения более раннего поля. */
export interface FieldCondition {
  fieldId: string;
  operator: ConditionOperator;
  value?: string | string[];
}

export interface TicketFieldOption {
  value: string;
  label: string;
}

export interface TicketField {
  id: string;
  type: TicketFieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: TicketFieldOption[];
  helpText?: string;
  order?: number;
  defaultValue?: any;
  visibleWhen?: FieldCondition;
}

/** Автозаполнение тикета при создании из шаблона. */
export interface TemplateAutomation {
  priority?: TicketPriority | null;
  assignTo?: number | null;
}

export interface TicketTemplateSchema {
  fields: TicketField[];
  automation?: TemplateAutomation;
  [key: string]: any;
}

export interface TicketTemplateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  schema?: TicketTemplateSchema;
  isActive?: boolean;
}

export interface TicketTemplate {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
  category: string | null;
  schema: TicketTemplateSchema;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface TicketTemplateListResponse {
  items: TicketTemplate[];
}

export interface TicketTemplateResponse {
  template: TicketTemplate;
}

export type TicketStatus = 'open' | 'resolved';

export interface Ticket {
  id: number;
  tenant_id: number;
  template_id: number | null;
  template_name: string;
  template_schema: TicketTemplateSchema;
  data: Record<string, any>;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  resolved_by: number | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketListResponse {
  items: Ticket[];
}

export interface TicketResponse {
  ticket: Ticket;
}

export type CheckLevel = 'ok' | 'warning' | 'critical';

export interface StatusCheck {
  key: string;
  label: string;
  level: CheckLevel;
  ok: boolean;
  value: string;
  detail?: string;
}

export interface SystemAlert {
  id: number;
  kind: string;
  severity: string;
  status: string;
  message: string;
  created_at: string;
}

export interface SystemStatus {
  ok: boolean;
  time: string;
  uptimeSec: number;
  checks: StatusCheck[];
  failing: string[];
}

export interface SystemAlertsResponse {
  items: SystemAlert[];
}

export interface TelegramWidgetData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface TelegramLoginConfig {
  enabled: boolean;
  botUsername: string | null;
}

export interface TelegramLinkState {
  linked: boolean;
  username: string | null;
}

/** Ответ шага 1 восстановления пароля через Telegram (см. /recover). */
export interface TelegramRecoveryStart {
  /** Одноразовый токен: им подтверждается шаг 2. */
  token: string;
  expiresAt: string;
  ttlMinutes: number;
  /** Имя аккаунта — чтобы человек убедился, что восстанавливает свой. */
  name: string;
  /** Email под маской («i***@mail.ru») либо null, если его нет. */
  email: string | null;
}

export interface OnlineOperator {
  id: number;
  name: string;
  /** Derived: online (free) / busy (has assigned chats) / offline. */
  status?: 'online' | 'busy' | 'offline';
}

export interface ArchiveFilters {
  status: string;
  from: string;
  to: string;
  tagIds: number[];
}

// --------------------------- Billing ---------------------------

export interface PlanPrice {
  months: number;
  /** Цена за весь период в центах USD. */
  price_cents: number;
}

export interface Plan {
  id: number;
  code: string;
  name: string;
  /** Price in USD cents per month; null = "цена по запросу" (Custom). */
  price_cents: number | null;
  operator_limit: number | null;
  description: string;
  features: string[];
  sort_order: number;
  is_active: boolean;
  /** Онлайн-цены по периодам (1 / 3 / 12 месяцев); пусто = продаётся вручную. */
  prices: PlanPrice[];
}

export interface Payment {
  id: number;
  plan_id: number | null;
  base_cents: number;
  amount_cents: number;
  promo_code_id?: number | null;
  discount_type?: 'percent' | 'fixed' | null;
  discount_value?: number | null;
  method: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  pay_url?: string | null;
  provider_invoice_id?: string | null;
  period_days: number;
  paid_at?: string | null;
  created_at: string;
}

/** Payment row as returned by the owner CRM (joined with tenant/plan/promo). */
export interface CrmPayment extends Payment {
  tenant_id: number;
  tenant_name: string;
  tenant_slug: string;
  plan_name?: string | null;
  plan_code?: string | null;
  promo_code?: string | null;
}

export interface PromoCode {
  id: number;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_activations: number | null;
  used_count: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
  created_by_name?: string | null;
  /** Тариф, на который выдан код (null = любой тариф). */
  plan_id: number | null;
  plan_code?: string | null;
  plan_name?: string | null;
}

export interface BillingInfo {
  status: string;
  paidUntil: string | null;
  planId: number | null;
  planCode: string | null;
  planName: string | null;
  operatorLimit: number | null;
  active: boolean;
}

export interface BillingOverview {
  billing: BillingInfo | null;
  plans: Plan[];
  payments: Payment[];
  providerConfigured: boolean;
}

export interface PromoQuote {
  valid: boolean;
  error?: string;
  code?: string;
  discountType?: 'percent' | 'fixed';
  discountValue?: number;
  baseCents?: number;
  discountCents?: number;
  amountCents?: number;
  /** Период, к которому применили промокод. */
  months?: number;
  days?: number;
  /** Заполняется, когда промокод привязан к другому тарифу. */
  boundPlan?: { code: string; name: string } | null;
}

export interface CheckoutResult {
  free: boolean;
  payment: Payment;
  baseCents: number;
  discountCents: number;
  amountCents: number;
  months: number;
  days: number;
  payUrl: string | null;
  providerConfigured?: boolean;
  message?: string;
}

/** Payload for creating/updating a promo code in the CRM. */
export interface PromoInput {
  code?: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  maxActivations?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  /** Тариф, на который выдан код (null/undefined = любой тариф). */
  planId?: number | null;
  isActive?: boolean;
}
