import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError } from '../lib/errors.js';

/** Global settings that apply across all servers (currently: the shared whitelist). */
export function globalRouter(ctx: AppContext): Router {
  const r = Router();

  r.get(
    '/whitelist',
    asyncHandler(async (_req, res) => {
      res.json({ whitelist: ctx.manager.getGlobalWhitelist() });
    }),
  );

  r.put(
    '/whitelist',
    asyncHandler(async (req, res) => {
      const parsed = z.object({ whitelist: z.array(z.string().max(100)) }).safeParse(req.body);
      if (!parsed.success) throw new ValidationError('whitelist must be an array of names');
      res.json({ whitelist: ctx.manager.setGlobalWhitelist(parsed.data.whitelist) });
    }),
  );

  return r;
}
