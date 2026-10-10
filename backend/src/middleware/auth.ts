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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const user = await resolveOperator(authHeader.slice('Bearer '.length));
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