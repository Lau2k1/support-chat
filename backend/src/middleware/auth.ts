import express from 'express';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev_fallback_secret';

export interface AuthenticatedRequest extends express.Request {
  user?: { id: number; name: string; role: string };
}

export function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = authHeader.split(' ')[1];
    (req as AuthenticatedRequest).user = jwt.verify(token, SECRET) as { id: number; name: string; role: string };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function adminMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((req as AuthenticatedRequest).user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export { SECRET };
