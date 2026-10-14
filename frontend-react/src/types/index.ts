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
  rating?: number;
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
  public_code?: string;
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

export interface Plan {
  id: number;
  code: string;
  name: string;
  /** Price in USD cents; null = "цена по запросу" (Custom). */
  price_cents: number | null;
  operator_limit: number | null;
  description: string;
  features: string[];
  sort_order: number;
  is_active: boolean;
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
}

export interface CheckoutResult {
  free: boolean;
  payment: Payment;
  baseCents: number;
  discountCents: number;
  amountCents: number;
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
  isActive?: boolean;
}
