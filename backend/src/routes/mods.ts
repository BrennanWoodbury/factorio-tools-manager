import { Router } from 'express';
import type { AppContext } from '../context.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * Global mod-portal endpoints not tied to a specific server. Currently: catalog
 * search (public metadata — no mod-portal credentials required).
 */
export function modsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get(
    '/search',
    asyncHandler(async (req, res) => {
      const q = String(req.query.q ?? '');
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50);
      const results = await ctx.mods.search(q, limit);
      res.json({ results });
    }),
  );

  return r;
}
