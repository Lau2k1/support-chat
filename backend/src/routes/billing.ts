import { Router } from 'express';
import { pool } from '../db';
import { authMiddleware, tenantAdminMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import {
  listPlans,
  getPlanByCode,
  planPeriodPrice,
  findPromoByCode,
  promoError,
  computeQuote,
  tenantBillingInfo,
  markPaymentPaid,
  type PlanRow,
} from '../services/billing';
import { createInvoice, getInvoice, isConfigured as cryptoConfigured } from '../services/cryptobot';
import { notifyPaymentRequest } from '../services/notify';
import { periodDays, periodLabel } from '../utils/periods';

/**
 * Tenant billing: view the current subscription, pick a plan, apply a promo code
 * and pay. Online payment is provided by CryptoBot when configured; otherwise the
 * owner confirms the payment manually from the CRM (pay_url stays null).
 */
const router = Router();
router.use(authMiddleware, tenantAdminMiddleware);

const PAYMENT_FIELDS =
  'id, plan_id, base_cents, amount_cents, promo_code_id, discount_type, discount_value, method, status, pay_url, provider_invoice_id, period_days, paid_at, created_at';

/**
 * Период оплаты из тела запроса. Старые клиенты его не присылают — для них
 * это по-прежнему месяц. Отдельная функция, чтобы промокод и оформление
 * проверяли период одинаково.
 */
function parseMonths(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 1;
  const months = Number(value);
  return Number.isInteger(months) && months > 0 && months <= 36 ? months : null;
}

/** Цена периода или текст отказа, если тариф/период не продаётся онлайн. */
function periodPrice(plan: PlanRow, months: number): { baseCents: number } | { error: string } {
  if (plan.price_cents === null) {
    return {
      error: 'Тариф Custom обсуждается индивидуально — напишите нам в Telegram @sctManager',
    };
  }
  const baseCents = planPeriodPrice(plan, months);
  if (baseCents === null) return { error: 'Для этого периода цена не задана' };
  return { baseCents };
}

/** Current tenant id, or null for the superadmin (who owns no tenant). */
function tenantOf(req: AuthenticatedRequest): number | null {
  return req.user?.tenantId ?? null;
}

router.get('/', async (req, res) => {
  const tenantId = tenantOf(req as AuthenticatedRequest);
  if (tenantId === null) return res.status(400).json({ error: 'Тенант не определён' });
  try {
    const [billing, plans, payments] = await Promise.all([
      tenantBillingInfo(tenantId),
      listPlans(),
      pool.query(`SELECT ${PAYMENT_FIELDS} FROM payments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`, [tenantId]),
    ]);
    res.json({ billing, plans, payments: payments.rows, providerConfigured: cryptoConfigured() });
  } catch (e) {
    console.error('billing GET error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

/** Validates a promo code against a plan and returns the resulting price. */
router.post('/promo/validate', async (req, res) => {
  try {
    const planCode = typeof req.body?.planCode === 'string' ? req.body.planCode : '';
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const months = parseMonths(req.body?.months);
    if (months === null) return res.status(400).json({ error: 'Неверный период оплаты' });
    const plan = planCode ? await getPlanByCode(planCode) : null;
    if (!plan || !plan.is_active) return res.status(400).json({ error: 'Тариф не найден' });
    const price = periodPrice(plan, months);
    if ('error' in price) return res.status(400).json({ error: price.error });
    if (!code.trim()) return res.status(400).json({ error: 'Введите промокод' });

    const promo = await findPromoByCode(code);
    const err = promoError(promo, plan);
    if (err) {
      // Промокод привязан к другому тарифу — подсказываем фронтенду, куда
      // переключиться. Только если в остальном код действителен: иначе тариф
      // менять незачем, показываем причину отказа как есть.
      const usable = !!promo && promoError(promo, null) === null;
      const boundPlan =
        usable && promo!.plan_code && promo!.plan_id !== plan.id
          ? { code: promo!.plan_code, name: promo!.plan_name ?? promo!.plan_code }
          : null;
      return res.json({ valid: false, error: err, boundPlan });
    }

    const quote = computeQuote(price.baseCents, promo);
    res.json({
      valid: true,
      code: promo!.code,
      discountType: promo!.discount_type,
      discountValue: promo!.discount_value,
      months,
      days: periodDays(months),
      ...quote,
    });
  } catch (e) {
    console.error('billing promo error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

/** Creates a payment (and a CryptoBot invoice when configured) for a plan. */
router.post('/checkout', async (req, res) => {
  const tenantId = tenantOf(req as AuthenticatedRequest);
  if (tenantId === null) return res.status(400).json({ error: 'Тенант не определён' });
  try {
    const planCode = typeof req.body?.planCode === 'string' ? req.body.planCode : '';
    const promoCode = typeof req.body?.promoCode === 'string' ? req.body.promoCode.trim() : '';
    const months = parseMonths(req.body?.months);
    if (months === null) return res.status(400).json({ error: 'Неверный период оплаты' });

    const plan = await getPlanByCode(planCode);
    if (!plan || !plan.is_active) return res.status(400).json({ error: 'Тариф не найден' });
    const price = periodPrice(plan, months);
    if ('error' in price) return res.status(400).json({ error: price.error });

    let promo = null;
    if (promoCode) {
      promo = await findPromoByCode(promoCode);
      const err = promoError(promo, plan);
      if (err) return res.status(400).json({ error: err });
    }

    const quote = computeQuote(price.baseCents, promo);
    const days = periodDays(months);

    // 100% promo → the subscription is free; activate immediately.
    if (quote.amountCents <= 0) {
      const ins = await pool.query(
        `INSERT INTO payments (tenant_id, plan_id, base_cents, amount_cents, promo_code_id, discount_type, discount_value, method, status, period_days)
         VALUES ($1, $2, $3, 0, $4, $5, $6, 'promo', 'pending', $7) RETURNING ${PAYMENT_FIELDS}`,
        [tenantId, plan.id, quote.baseCents, promo?.id ?? null, promo?.discount_type ?? null, promo?.discount_value ?? null, days]
      );
      await markPaymentPaid(ins.rows[0].id, { method: 'promo' });
      const fresh = await pool.query(`SELECT ${PAYMENT_FIELDS} FROM payments WHERE id = $1`, [ins.rows[0].id]);
      return res.status(201).json({ free: true, payment: fresh.rows[0], ...quote, months, days, payUrl: null });
    }

    const ins = await pool.query(
      `INSERT INTO payments (tenant_id, plan_id, base_cents, amount_cents, promo_code_id, discount_type, discount_value, method, status, period_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'cryptobot', 'pending', $8) RETURNING ${PAYMENT_FIELDS}`,
      [tenantId, plan.id, quote.baseCents, quote.amountCents, promo?.id ?? null, promo?.discount_type ?? null, promo?.discount_value ?? null, days]
    );
    const paymentId = ins.rows[0].id;

    if (cryptoConfigured()) {
      try {
        const invoice = await createInvoice({
          amountCents: quote.amountCents,
          description: `SupportChat — тариф «${plan.name}» на ${periodLabel(months)}`,
          payload: JSON.stringify({ tenantId, planCode: plan.code, paymentId }),
          expiresInSeconds: 3600,
        });
        const payUrl = invoice.pay_url || invoice.bot_invoice_url || invoice.mini_app_invoice_url || null;
        const upd = await pool.query(
          `UPDATE payments SET provider_invoice_id = $2, pay_url = $3 WHERE id = $1 RETURNING ${PAYMENT_FIELDS}`,
          [paymentId, String(invoice.invoice_id), payUrl]
        );
        return res.status(201).json({ free: false, payment: upd.rows[0], ...quote, months, days, payUrl, providerConfigured: true });
      } catch (e) {
        console.error('crypto invoice error:', e);
        await pool.query("UPDATE payments SET status = 'failed' WHERE id = $1", [paymentId]);
        return res.status(502).json({ error: 'Не удалось создать счёт на оплату. Попробуйте позже.' });
      }
    }

    // No online provider configured → the owner confirms the payment manually.
    // Это и есть «заявка»: сообщаем владельцу сразу, чтобы лид не остыл.
    const owner = (
      await pool.query('SELECT name, slug FROM tenants WHERE id = $1', [tenantId])
    ).rows[0] as { name: string; slug: string } | undefined;
    notifyPaymentRequest({
      tenantName: owner?.name ?? `#${tenantId}`,
      slug: owner?.slug ?? '—',
      planName: plan.name,
      amountCents: quote.amountCents,
      months,
      promoCode: promo?.code ?? null,
      paymentId,
    });

    res.status(201).json({
      free: false,
      payment: ins.rows[0],
      ...quote,
      months,
      days,
      payUrl: null,
      providerConfigured: false,
      message: 'Онлайн-оплата временно недоступна. Мы свяжемся с вами для выставления счёта.',
    });
  } catch (e) {
    console.error('billing checkout error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

/** Polls the provider for a pending payment and activates it when it is paid. */
router.post('/payments/:id/sync', async (req, res) => {
  const tenantId = tenantOf(req as AuthenticatedRequest);
  if (tenantId === null) return res.status(400).json({ error: 'Тенант не определён' });
  try {
    const id = Number(req.params.id);
    const p = await pool.query(`SELECT ${PAYMENT_FIELDS} FROM payments WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    const payment = p.rows[0];
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });
    if (payment.status === 'paid' || payment.status !== 'pending') return res.json({ status: payment.status });

    if (payment.provider_invoice_id && cryptoConfigured()) {
      try {
        const invoice = await getInvoice(payment.provider_invoice_id);
        if (invoice && invoice.status === 'paid') await markPaymentPaid(payment.id, { method: 'cryptobot' });
      } catch (e) {
        console.error('billing sync error:', e);
      }
    }
    const after = await pool.query('SELECT status FROM payments WHERE id = $1', [id]);
    res.json({ status: after.rows[0].status });
  } catch (e) {
    console.error('billing sync error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

/** Cancels a pending payment. */
router.post('/payments/:id/cancel', async (req, res) => {
  const tenantId = tenantOf(req as AuthenticatedRequest);
  if (tenantId === null) return res.status(400).json({ error: 'Тенант не определён' });
  try {
    const result = await pool.query(
      "UPDATE payments SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2 AND status = 'pending' RETURNING id",
      [Number(req.params.id), tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Активный платёж не найден' });
    res.json({ ok: true });
  } catch (e) {
    console.error('billing cancel error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

export default router;
