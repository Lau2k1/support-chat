import { pool } from '../db';

/**
 * Billing domain logic shared by the tenant billing routes and the owner CRM:
 * plan catalog, promo-code validation, price quotes and subscription activation.
 */

export interface PlanRow {
  id: number;
  code: string;
  name: string;
  price_cents: number | null;
  operator_limit: number | null;
  description: string;
  features: string[];
  sort_order: number;
  is_active: boolean;
}

export interface PromoRow {
  id: number;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_activations: number | null;
  used_count: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
}

export async function listPlans(): Promise<PlanRow[]> {
  const r = await pool.query(
    "SELECT id, code, name, price_cents, operator_limit, description, features, sort_order, is_active FROM plans WHERE is_active = true ORDER BY sort_order, id"
  );
  return r.rows;
}

export async function getPlanByCode(code: string): Promise<PlanRow | null> {
  const r = await pool.query('SELECT * FROM plans WHERE code = $1', [code]);
  return r.rows[0] ?? null;
}

/** Returns a user-facing error string when the promo cannot be used, else null. */
export function promoError(promo: PromoRow | null | undefined): string | null {
  if (!promo) return 'Промокод не найден';
  if (!promo.is_active) return 'Промокод неактивен';
  const now = Date.now();
  if (promo.valid_from && new Date(promo.valid_from).getTime() > now) return 'Промокод ещё не действует';
  if (promo.valid_until && new Date(promo.valid_until).getTime() < now) return 'Срок действия промокода истёк';
  if (promo.max_activations !== null && promo.used_count >= promo.max_activations) return 'Промокод исчерпан';
  return null;
}

export async function findPromoByCode(code: string): Promise<PromoRow | null> {
  const r = await pool.query('SELECT * FROM promo_codes WHERE upper(code) = $1', [code.trim().toUpperCase()]);
  return r.rows[0] ?? null;
}

/** Quote for a plan, optionally discounted by a promo code. */
export function computeQuote(baseCents: number, promo: PromoRow | null): { baseCents: number; discountCents: number; amountCents: number } {
  let discountCents = 0;
  if (promo) {
    discountCents = promo.discount_type === 'percent'
      ? Math.round((baseCents * promo.discount_value) / 100)
      : promo.discount_value;
    if (discountCents < 0) discountCents = 0;
    if (discountCents > baseCents) discountCents = baseCents;
  }
  return { baseCents, discountCents, amountCents: baseCents - discountCents };
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

export async function tenantBillingInfo(tenantId: number): Promise<BillingInfo | null> {
  const r = await pool.query(
    `SELECT t.billing_status, t.paid_until, t.plan_id, t.operator_limit,
            p.code AS plan_code, p.name AS plan_name
     FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
     WHERE t.id = $1`,
    [tenantId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    status: row.billing_status,
    paidUntil: row.paid_until ? new Date(row.paid_until).toISOString() : null,
    planId: row.plan_id ?? null,
    planCode: row.plan_code ?? null,
    planName: row.plan_name ?? null,
    operatorLimit: row.operator_limit ?? null,
    active: isActiveBilling(row.billing_status, row.paid_until),
  };
}

/** A tenant may use the product when paid; paid_until NULL means lifetime. */
export function isActiveBilling(status: string | null | undefined, paidUntil: string | Date | null | undefined): boolean {
  if (status !== 'active') return false;
  if (!paidUntil) return true;
  return new Date(paidUntil).getTime() > Date.now();
}

/**
 * Marks a payment as paid and extends the tenant's subscription. Idempotent:
 * calling it again on an already-paid payment is a no-op. Runs in a single
 * transaction and consumes one promo activation.
 */
export async function markPaymentPaid(
  paymentId: number,
  opts: { method?: string; confirmedBy?: number | null } = {}
): Promise<{ ok: boolean; alreadyPaid?: boolean; tenantId?: number; error?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
    const payment = p.rows[0];
    if (!payment) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Платёж не найден' };
    }
    if (payment.status === 'paid') {
      await client.query('ROLLBACK');
      return { ok: true, alreadyPaid: true, tenantId: payment.tenant_id };
    }
    if (payment.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Платёж отменён или недействителен' };
    }

    const plan = (await client.query('SELECT * FROM plans WHERE id = $1', [payment.plan_id])).rows[0] ?? null;

    // Consume one promo activation (guarded so we never exceed max_activations).
    if (payment.promo_code_id) {
      await client.query(
        `UPDATE promo_codes SET used_count = used_count + 1
         WHERE id = $1 AND (max_activations IS NULL OR used_count < max_activations)`,
        [payment.promo_code_id]
      );
    }

    await client.query(
      `UPDATE payments
       SET status = 'paid', paid_at = CURRENT_TIMESTAMP,
           method = COALESCE($2, method), confirmed_by = COALESCE($3, confirmed_by)
       WHERE id = $1`,
      [paymentId, opts.method ?? null, opts.confirmedBy ?? null]
    );

    await client.query(
      `UPDATE tenants
       SET billing_status = 'active',
           plan_id = $2,
           operator_limit = COALESCE($3, operator_limit),
           paid_until = GREATEST(COALESCE(paid_until, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + make_interval(days => $4),
           billing_updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [payment.tenant_id, payment.plan_id, plan?.operator_limit ?? null, payment.period_days]
    );

    await client.query('COMMIT');
    return { ok: true, tenantId: payment.tenant_id };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
