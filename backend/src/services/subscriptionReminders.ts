import { pool } from '../db';
import { esc, formatDay, notifyConfigured, notifyOwnerOnce } from './notify';

/**
 * Напоминания владельцу об окончании подписок. Запускается таймером из
 * server.ts. Уведомления привязаны к порогам (5 дней и последний день) и
 * отправляются один раз на каждую дату окончания — за это отвечает ключ
 * события в notified_events, поэтому перезапуск контейнера безопасен.
 *
 * Зачем: без этого продление зависит от того, вспомнит ли владелец заглянуть
 * в CRM, а истёкшая подписка мгновенно отключает клиенту ответы операторов.
 */

interface ExpiringRow {
  id: number;
  name: string;
  slug: string;
  paid_until: Date;
  plan_name: string | null;
  days_left: number;
}

/** Пропущенные нами пороги: за 5 дней и в последний день. */
function thresholdFor(daysLeft: number): 5 | 1 | null {
  if (daysLeft < 1) return null;
  return daysLeft <= 1 ? 1 : daysLeft <= 5 ? 5 : null;
}

export async function runSubscriptionReminders(): Promise<void> {
  if (!notifyConfigured()) return;

  let rows: ExpiringRow[];
  try {
    // Календарные дни считаем по Москве — так же, как их видит владелец в CRM.
    const res = await pool.query(
      `SELECT t.id, t.name, t.slug, t.paid_until, p.name AS plan_name,
              ((t.paid_until AT TIME ZONE 'Europe/Moscow')::date
               - (now() AT TIME ZONE 'Europe/Moscow')::date) AS days_left
         FROM tenants t
         LEFT JOIN plans p ON p.id = t.plan_id
        WHERE t.status = 'active'
          AND t.paid_until IS NOT NULL
          AND t.paid_until >= now() - INTERVAL '2 days'
          AND t.paid_until <  now() + INTERVAL '7 days'
        ORDER BY t.paid_until`
    );
    rows = res.rows.map((r) => ({ ...r, days_left: Number(r.days_left) }));
  } catch (e) {
    console.warn('[reminders] не удалось прочитать подписки:', e instanceof Error ? e.message : e);
    return;
  }

  for (const row of rows) {
    const day = formatDay(row.paid_until);
    const who = `<b>${esc(row.name)}</b> · <code>${esc(row.slug)}</code>`;
    const plan = esc(row.plan_name ?? 'без тарифа');

    // Уже истекла — владельцу важно узнать сразу, клиент теряет доступ.
    if (row.days_left < 1) {
      await notifyOwnerOnce(
        `expired:${row.id}:${day}`,
        `⚠️ <b>Подписка закончилась</b>\nКлиент: ${who}\nТариф: ${plan}\nСрок истёк ${esc(day)} — напишите про продление.`
      );
      continue;
    }

    const threshold = thresholdFor(row.days_left);
    if (!threshold) continue;

    await notifyOwnerOnce(
      `expiring:${row.id}:${day}:${threshold}`,
      `⏳ <b>Подписка истекает</b>\nКлиент: ${who}\nТариф: ${plan}\nОсталось: ${row.days_left} дн. (до ${esc(day)})`
    );
  }
}
