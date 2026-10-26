import { pool } from '../db';
import type { PoolClient } from 'pg';
import { notifyPaymentPaid } from './notify';

/**
 * Billing domain logic shared by the tenant billing routes and the owner CRM:
 * plan catalog, promo-code validation, price quotes and subscription activation.
 */

export interface PlanPrice {
  months: number;
  /** Цена за весь период в центах USD. */
  price_cents: number;
}

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
  /** Онлайн-цены по периодам (1 / 3 / 12 месяцев); пусто = продаётся вручную. */
  prices: PlanPrice[];
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
  /** Tariff the promo is bound to (owner CRM). null = any plan. */
  plan_id: number | null;
  plan_code?: string | null;
  plan_name?: string | null;
}

const PLAN_FIELDS = `
  p.id, p.code, p.name, p.price_cents, p.operator_limit, p.description,
  p.features, p.sort_order, p.is_active,
  COALESCE(
    json_agg(json_build_object('months', pp.months, 'price_cents', pp.price_cents)
             ORDER BY pp.months) FILTER (WHERE pp.months IS NOT NULL),
    '[]'::json
  ) AS prices`;

async function selectPlans(where: string, params: unknown[] = []): Promise<PlanRow[]> {
  const r = await pool.query(
    `SELECT ${PLAN_FIELDS}
       FROM plans p
       LEFT JOIN plan_prices pp ON pp.plan_id = p.id
      ${where}
      GROUP BY p.id
      ORDER BY p.sort_order, p.id`,
    params
  );
  return r.rows;
}

export async function listPlans(): Promise<PlanRow[]> {
  return selectPlans('WHERE p.is_active = true');
}

export async function getPlanByCode(code: string): Promise<PlanRow | null> {
  const rows = await selectPlans('WHERE p.code = $1', [code]);
  return rows[0] ?? null;
}

/**
 * Цена тарифа за период в месяцах. null означает, что период не продаётся
 * онлайн (например, «Custom» или период, который владелец ещё не завёл).
 */
export function planPeriodPrice(plan: Pick<PlanRow, 'prices'>, months: number): number | null {
  return plan.prices.find((p) => p.months === months)?.price_cents ?? null;
}

/**
 * Returns a user-facing error string when the promo cannot be used, else null.
 * `plan` is the plan the code is being applied to: a promo bound to a specific
 * tariff is rejected for any other one.
 */
export function promoError(promo: PromoRow | null | undefined, plan?: Pick<PlanRow, 'id'> | null): string | null {
  if (!promo) return 'Промокод не найден';
  if (!promo.is_active) return 'Промокод неактивен';
  const now = Date.now();
  if (promo.valid_from && new Date(promo.valid_from).getTime() > now) return 'Промокод ещё не действует';
  if (promo.valid_until && new Date(promo.valid_until).getTime() < now) return 'Срок действия промокода истёк';
  if (promo.max_activations !== null && promo.used_count >= promo.max_activations) return 'Промокод исчерпан';
  if (promo.plan_id != null && plan && promo.plan_id !== plan.id) {
    return promo.plan_name
      ? `Промокод действует только на тариф «${promo.plan_name}»`
      : 'Промокод действует только на другой тариф';
  }
  return null;
}

export async function findPromoByCode(code: string): Promise<PromoRow | null> {
  const r = await pool.query(
    `SELECT p.*, pl.code AS plan_code, pl.name AS plan_name
       FROM promo_codes p LEFT JOIN plans pl ON pl.id = p.plan_id
      WHERE upper(p.code) = $1`,
    [code.trim().toUpperCase()]
  );
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
 * Обрезает неиспользованные инвайты до лимита мест тарифа и возвращает число
 * удалённых кодов. Место занимают операторы (их не удаляем — это решение админа)
 * и выданные, но ещё не использованные коды, поэтому при смене тарифа вниз
 * «лишние» коды сгорают: самые новые (их админ выдавал последними).
 *
 * Принимает и pool, и клиент транзакции — активация платежа вызывает внутри
 * своей транзакции, ручная выдача тарифа из CRM — сразу после UPDATE.
 */
export async function trimPendingInvites(
  client: Pick<PoolClient, 'query'>,
  tenantId: number,
  operatorLimit: number
): Promise<number> {
  const seats = await client.query<{ operators: number; pending: number }>(
    `SELECT (SELECT COUNT(*)::int FROM operators o WHERE o.tenant_id = $1) AS operators,
            (SELECT COUNT(*)::int FROM invite_codes ic
              WHERE ic.tenant_id = $1 AND ic.used_by IS NULL
                AND (ic.expires_at IS NULL OR ic.expires_at > now())) AS pending`,
    [tenantId]
  );
  const operators = seats.rows[0]?.operators ?? 0;
  const pending = seats.rows[0]?.pending ?? 0;
  const excess = pending - Math.max(0, operatorLimit - operators);
  if (excess <= 0) return 0;

  const del = await client.query(
    `DELETE FROM invite_codes WHERE id IN (
       SELECT id FROM invite_codes
        WHERE tenant_id = $1 AND used_by IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC, id DESC
        LIMIT $2
     )`,
    [tenantId, excess]
  );
  return del.rowCount ?? 0;
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
    const tenant = (await client.query('SELECT name, slug FROM tenants WHERE id = $1', [payment.tenant_id]))
      .rows[0] as { name: string; slug: string } | undefined;

    // Consume one promo activation (guarded so we never exceed max_activations).
    if (payment.promo_code_id) {
      const consumed = await client.query(
        `UPDATE promo_codes SET used_count = used_count + 1
         WHERE id = $1 AND (max_activations IS NULL OR used_count < max_activations)`,
        [payment.promo_code_id]
      );
      // Лимит мог исчерпаться между оформлением и оплатой. Платёж всё равно
      // активируем (деньги уже пришли), но в лог пишем — иначе расхождение
      // счётчика активаций останется незамеченным.
      if (!consumed.rowCount) {
        console.warn(
          `[billing] промокод #${payment.promo_code_id} исчерпан — платёж #${paymentId} активирован без списания`
        );
      }
    }

    await client.query(
      `UPDATE payments
       SET status = 'paid', paid_at = CURRENT_TIMESTAMP,
           method = COALESCE($2, method), confirmed_by = COALESCE($3, confirmed_by)
       WHERE id = $1`,
      [paymentId, opts.method ?? null, opts.confirmedBy ?? null]
    );

    const sub = await client.query(
      `UPDATE tenants
       SET billing_status = 'active',
           plan_id = $2,
           operator_limit = COALESCE($3, operator_limit),
           paid_until = GREATEST(COALESCE(paid_until, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + make_interval(days => $4),
           billing_updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING paid_until`,
      [payment.tenant_id, payment.plan_id, plan?.operator_limit ?? null, payment.period_days]
    );

    // Переход на более низкий тариф: неиспользованные инвайты обрезаем до нового
    // лимита мест. Операторов не трогаем (это решение админа), поэтому при
    // переполнении по операторам снимаем все лишние коды.
    const droppedInvites =
      plan?.operator_limit == null
        ? 0
        : await trimPendingInvites(client, payment.tenant_id, plan.operator_limit);

    await client.query('COMMIT');

    if (droppedInvites > 0) {
      console.log(
        `[billing] тенант #${payment.tenant_id}: тариф «${plan?.name ?? plan?.code}» — удалено неиспользованных инвайтов: ${droppedInvites}`
      );
    }

    // Оплата — событие, о котором владелец должен узнать сразу (в CRM он может
    // и не заглянуть). Отправляется после COMMIT и не влияет на результат.
    notifyPaymentPaid({
      tenantName: tenant?.name ?? `#${payment.tenant_id}`,
      slug: tenant?.slug ?? '—',
      planName: plan?.name ?? 'без тарифа',
      amountCents: payment.amount_cents,
      days: payment.period_days,
      method: opts.method ?? payment.method,
      paidUntil: sub.rows[0]?.paid_until ?? null,
    });

    return { ok: true, tenantId: payment.tenant_id };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
