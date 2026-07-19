import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { clearSessionCookie, issueToken, setSessionCookie } from '../middleware/auth.js';

/**
 * Minimal single-admin auth. A correct password (from ADMIN_PASSWORD) mints a
 * signed session cookie. Timing-safe-ish via constant work isn't attempted here
 * because there's a single credential and rate is human-driven; keep it simple.
 */
export function authRouter(ctx: AppContext): Router {
  const r = Router();

  r.post(
    '/login',
    asyncHandler(async (req, res) => {
      const body = z.object({ password: z.string() }).safeParse(req.body);
      if (!body.success || body.data.password !== ctx.config.adminPassword) {
        res.status(401).json({ error: { code: 'BAD_CREDENTIALS', message: 'Incorrect password' } });
        return;
      }
      setSessionCookie(res, issueToken(ctx.config));
      res.json({ ok: true });
    }),
  );

  r.post(
    '/logout',
    asyncHandler(async (_req, res) => {
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  // Whether the current cookie is valid (used by the SPA on load).
  r.get(
    '/me',
    asyncHandler(async (req, res) => {
      const token = req.cookies?.ftm_session;
      if (!token) {
        res.status(401).json({ authenticated: false });
        return;
      }
      try {
        const jwt = (await import('jsonwebtoken')).default;
        jwt.verify(token, ctx.config.jwtSecret);
        res.json({ authenticated: true });
      } catch {
        res.status(401).json({ authenticated: false });
      }
    }),
  );

  return r;
}
