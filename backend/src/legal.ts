import type { Request } from 'express';

/**
 * Редакции юридических документов, действующих на момент акцепта.
 *
 * Версии дублируются в текстах страниц `landing/legal/*.html` — при выпуске
 * новой редакции обновите оба места (здесь и в самом документе), иначе запись
 * об акцепте будет ссылаться на несуществующую редакцию.
 */
export const LEGAL = {
  offer: '1.0',
  privacy: '1.0',
  consent: '1.0',
  dpa: '1.0',
  cookies: '1.0',
  effectiveDate: '2026-10-15',
} as const;

/** Каким способом пользователь принял документы. */
export type AcceptanceSource = 'register' | 'invite' | 'telegram';

interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/**
 * Фиксирует акцепт оферты и согласие на обработку персональных данных.
 *
 * Запись — это доказательство воли пользователя: храним редакции документов,
 * момент времени, способ принятия и технические данные соединения. Вызывается
 * в той же транзакции, что и создание учётной записи, чтобы не появилось
 * аккаунтов без подтверждённого акцепта.
 */
export async function recordAcceptance(
  client: Queryable,
  params: {
    operatorId: number | null;
    tenantId: number | null;
    email: string | null;
    source: AcceptanceSource;
    marketingConsent: boolean;
    req: Request;
  }
): Promise<void> {
  const ua = params.req.get('user-agent');
  await client.query(
    `INSERT INTO legal_acceptances
       (operator_id, tenant_id, email, source, offer_version, privacy_version,
        consent_version, dpa_version, marketing_consent, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      params.operatorId,
      params.tenantId,
      params.email,
      params.source,
      LEGAL.offer,
      LEGAL.privacy,
      LEGAL.consent,
      LEGAL.dpa,
      params.marketingConsent,
      (params.req.ip || '').slice(0, 64),
      ua ? ua.slice(0, 500) : null,
    ]
  );
}
