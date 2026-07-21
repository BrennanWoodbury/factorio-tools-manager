import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError } from '../lib/errors.js';
import { dnsSettingsDto, getDnsSettings, setDnsSettings } from '../services/dnsSettings.js';

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ValidationError(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

/** Global settings that apply across all servers (whitelist + DNS/Cloudflare). */
export function globalRouter(ctx: AppContext): Router {
  const r = Router();

  // ---- DNS / Cloudflare (all configured here, nothing in env) ----

  r.get(
    '/dns',
    asyncHandler(async (_req, res) => {
      res.json({ dns: dnsSettingsDto(getDnsSettings(ctx.db)) });
    }),
  );

  r.put(
    '/dns',
    asyncHandler(async (req, res) => {
      const body = parse(
        z.object({
          baseDomain: z.string().max(253).optional(),
          hostRecordName: z.string().max(253).optional(),
          cloudflareZoneId: z.string().max(64).optional(),
          // Only sent when the admin (re)enters it. '' explicitly clears it.
          cloudflareToken: z.string().max(200).optional(),
          ddnsIntervalSeconds: z.number().int().min(30).max(86400).optional(),
          ipCheckUrl: z.string().url().max(300).optional(),
        }),
        req.body,
      );
      setDnsSettings(ctx.db, body);
      // Apply interval / enabled-state changes to the running DDNS job immediately.
      ctx.ddns.reschedule();
      res.json({ dns: dnsSettingsDto(getDnsSettings(ctx.db)) });
    }),
  );

  r.post(
    '/dns/test',
    asyncHandler(async (_req, res) => {
      res.json(await ctx.dns.testConnection());
    }),
  );

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
