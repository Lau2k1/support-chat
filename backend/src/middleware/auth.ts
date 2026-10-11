import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db';

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
    { expiresIn: TOKEN_TTL }
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
    payload = jwt.verify(token, SECRET) as unknown as JwtPayload;
  } catch {
    return null;
  }
  if (!payload?.id) return null;

  const result = await pool.query(
    'SELECT id, name, role, is_enabled, token_version, tenant_id FROM operators WHERE id = $1',
    [payload.id]
  );
  const op = result.rows[0];
  if (!op || !op.is_enabled) return null;
  if (Number(payload.tv ?? 0) !== Number(op.token_version)) return null;

  return { id: op.id, name: op.name, role: op.role, tenantId: op.tenant_id ?? null };
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