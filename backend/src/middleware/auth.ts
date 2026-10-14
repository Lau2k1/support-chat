import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { isActiveBilling } from '../services/billing';

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error('JWT_SECRET environment variable is required');
}
const SECRET: string = secret;

export const TOKEN_TTL: jwt.SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN || '12h') as jwt.SignOptions['expiresIn'];

/** Name of the HttpOnly cookie that carries the session JWT. */
export const AUTH_COOKIE = 'sc_token';

/** Minimal cookie-header parser (no extra dependency needed). */
export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    let value = part.slice(i + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw value */
    }
    out[key] = value;
  }
  return out;
}

/**
 * Extracts the session JWT from either the `Authorization: Bearer` header or the
 * HttpOnly auth cookie. Bearer stays supported for API clients and smoke tests.
 */
export function tokenFromRequest(req: { headers: Record<string, unknown> }): string | null {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const bearer = header.slice('Bearer '.length).trim();
    if (bearer) return bearer;
  }
  const rawCookie = req.headers['cookie'];
  const cookies = parseCookies(typeof rawCookie === 'string' ? rawCookie : undefined);
  return cookies[AUTH_COOKIE] || null;
}

/** Cookie max-age derived from JWT_EXPIRES_IN (falls back to 12h). */
export function tokenTtlMs(): number {
  const raw = String(process.env.JWT_EXPIRES_IN || '12h').trim();
  const m = /^(\d+)\s*([smhd])?$/.exec(raw);
  if (!m) return 12 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

/**
 * SEC-01: the session JWT is stored in an HttpOnly cookie so XSS cannot read it.
 * SameSite=Lax blocks cross-site POSTs (CSRF) while keeping top-level GET nav.
 */
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: tokenTtlMs(),
  };
}

export type OperatorRole = 'superadmin' | 'admin' | 'operator';

export interface AuthUser {
  id: number;
  name: string;
  role: OperatorRole;
  /** Tenant the operator belongs to. The superadmin belongs to none (null). */
  tenantId: number | null;
  /** Whether the tenant has paid an active subscription (superadmin: always true). */
  tenantActive: boolean;
  /** Raw billing state of the tenant (for the panel's paywall banner). */
  tenantBillingStatus?: string | null;
  tenantPaidUntil?: string | null;
  /** Email — null for accounts created through Telegram. */
  email?: string | null;
  /** Telegram account attached to this operator (Login Widget). */
  telegramId?: number | null;
  telegramUsername?: string | null;
  /** False when the account has no password (Telegram-only signup). */
  hasPassword?: boolean;
}

export interface JwtPayload {
  id: number;
  name: string;
  role: OperatorRole;
  tid?: number | null;
  tv?: number;
}

export interface AuthenticatedRequest extends express.Request {
  user?: AuthUser;
}

export function signToken(user: {
  id: number;
  name: string;
  role: string;
  token_version?: number;
  tenant_id?: number | null;
}): string {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      role: user.role,
      tid: user.tenant_id ?? null,
      tv: user.token_version ?? 0,
    },
    SECRET,
    { expiresIn: TOKEN_TTL, algorithm: 'HS256' }
  );
}

/**
 * Verifies a token signature and confirms the operator is still enabled and
 * that its token_version matches the DB (so role changes / disabling / revokes
 * invalidate previously issued tokens immediately).
 */
export async function resolveOperator(token: string): Promise<AuthUser | null> {
  let payload: JwtPayload;
  try {
    // SEC-13: pin the algorithm so an attacker can't switch to 'none' or an
    // asymmetric trick (e.g. HS256 with a public key as HMAC secret).
    payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as unknown as JwtPayload;
  } catch {
    return null;
  }
  if (!payload?.id) return null;

  const result = await pool.query(
    `SELECT o.id, o.name, o.role, o.is_enabled, o.token_version, o.tenant_id,
            o.email, o.telegram_id, o.telegram_username, (o.password IS NOT NULL) AS has_password,
            t.billing_status, t.paid_until
     FROM operators o
     LEFT JOIN tenants t ON t.id = o.tenant_id
     WHERE o.id = $1`,
    [payload.id]
  );
  const op = result.rows[0];
  if (!op || !op.is_enabled) return null;
  if (Number(payload.tv ?? 0) !== Number(op.token_version)) return null;

  const tenantId: number | null = op.tenant_id ?? null;
  const paidUntil = op.paid_until ? new Date(op.paid_until).toISOString() : null;
  // The superadmin owns no tenant and is never gated. A tenant is usable only
  // while its subscription is active (see services/billing.ts).
  const tenantActive = tenantId === null ? true : isActiveBilling(op.billing_status, op.paid_until);

  return {
    id: op.id,
    name: op.name,
    role: op.role,
    tenantId,
    tenantActive,
    tenantBillingStatus: op.billing_status ?? null,
    tenantPaidUntil: paidUntil,
    email: op.email ?? null,
    telegramId: op.telegram_id ?? null,
    telegramUsername: op.telegram_username ?? null,
    hasPassword: op.has_password === true,
  };
}

/**
 * Paths that stay reachable while a tenant is unpaid: the billing section itself,
 * session/profile actions (login, logout, password change) and the owner CRM.
 */
const UNPAID_EXEMPT_PREFIXES = ['/billing', '/superadmin', '/me', '/logout', '/login', '/register'];

function isUnpaidExempt(originalUrl: string): boolean {
  const path = originalUrl.split('?')[0];
  return UNPAID_EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = tokenFromRequest(req as unknown as { headers: Record<string, unknown> });
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const user = await resolveOperator(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    (req as AuthenticatedRequest).user = user;

    // Billing gate: an unpaid tenant can read everything ("видеть функционал"),
    // but any state-changing call is rejected until it pays a plan.
    if (
      user.role !== 'superadmin' &&
      user.tenantId !== null &&
      !user.tenantActive &&
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      req.method !== 'OPTIONS' &&
      !isUnpaidExempt(req.originalUrl)
    ) {
      return res.status(402).json({ error: 'Функции доступны после оплаты тарифа', code: 'PAYMENT_REQUIRED' });
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/** Tenant administrator — manages their own tenant only (superadmin passes everywhere). */
export function tenantAdminMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const role = (req as AuthenticatedRequest).user?.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/** Global superadmin only — tenant/platform management. */
export function superAdminMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((req as AuthenticatedRequest).user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}

export { SECRET };