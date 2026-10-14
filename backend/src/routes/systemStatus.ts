import { Router, Request, Response } from 'express';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth';
import { collectStatus, listAlerts, statusTokenValid } from '../services/monitor';

/**
 * External monitoring endpoint: GET /status.
 * Protected by a bearer token (STATUS_TOKEN) so it never leaks internals, and
 * deliberately NOT behind authMiddleware — an uptime monitor has no session.
 * When STATUS_TOKEN is unset the endpoint is disabled (503).
 */
export const publicStatusRouter = Router();

publicStatusRouter.get('/status', async (req: Request, res: Response) => {
  if (!process.env.STATUS_TOKEN) {
    return res.status(503).json({ error: 'Мониторинг не настроен (STATUS_TOKEN пуст)' });
  }
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!statusTokenValid(token)) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const status = await collectStatus(true);
  res.json(status);
});

/**
 * Owner CRM endpoints (superadmin session).
 * Mounted at /superadmin/system — the cached payload keeps the CRM's polling
 * from hammering the DB and the Telegram API.
 */
export const systemAdminRouter = Router();
systemAdminRouter.use(authMiddleware, superAdminMiddleware);

systemAdminRouter.get('/status', async (_req: Request, res: Response) => {
  res.json(await collectStatus());
});

systemAdminRouter.get('/alerts', async (req: Request, res: Response) => {
  const raw = req.query.limit;
  const limit = typeof raw === 'string' && raw !== '' ? Number(raw) : 50;
  const safe = Number.isFinite(limit) ? limit : 50;
  res.json({ items: await listAlerts(safe) });
});
