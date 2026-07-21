import { Router } from 'express';
import type { AppContext } from '../context.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/** System-wide health/introspection for the dashboard header. */
export function systemRouter(ctx: AppContext): Router {
  const r = Router();

  r.get(
    '/status',
    asyncHandler(async (_req, res) => {
      let dockerOk = true;
      let dockerError: string | undefined;
      try {
        await ctx.docker.ping();
      } catch (err) {
        dockerOk = false;
        dockerError = (err as Error).message;
      }

      res.json({
        docker: { ok: dockerOk, error: dockerError },
        dns: {
          enabled: ctx.dns.enabled,
          baseDomain: ctx.dns.settings().baseDomain || null,
          hostRecord: ctx.dns.settings().hostRecordName || null,
        },
        ddns: ctx.ddns.status(),
        ports: {
          game: {
            range: ctx.config.gamePortRange,
            ...ctx.allocator.capacity('game'),
          },
          rcon: {
            range: ctx.config.rconPortRange,
            ...ctx.allocator.capacity('rcon'),
          },
        },
      });
    }),
  );

  return r;
}
