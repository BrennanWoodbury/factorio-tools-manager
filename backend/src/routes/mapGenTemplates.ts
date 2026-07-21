import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError } from '../lib/errors.js';

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ValidationError(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

const settingsSchema = z.record(z.string(), z.unknown());

export function mapGenTemplatesRouter(ctx: AppContext): Router {
  const r = Router();
  const { mapGenTemplates: templates } = ctx;

  r.get('/', asyncHandler(async (_req, res) => res.json({ templates: templates.list() })));

  // The built-in default map-gen settings (for a blank editor in the create wizard).
  r.get('/defaults', asyncHandler(async (_req, res) => res.json({ settings: templates.defaults() })));

  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = parse(
        z.object({
          name: z.string().min(1).max(100),
          description: z.string().max(1000).optional(),
          settings: settingsSchema,
        }),
        req.body,
      );
      res.status(201).json(templates.create(body));
    }),
  );

  r.post(
    '/from-server',
    asyncHandler(async (req, res) => {
      const body = parse(
        z.object({ serverId: z.string().min(1), name: z.string().min(1).max(100) }),
        req.body,
      );
      res.status(201).json(templates.createFromServer(body.serverId, body.name));
    }),
  );

  r.post(
    '/import',
    asyncHandler(async (req, res) => {
      const body = parse(z.object({ manifest: z.record(z.string(), z.unknown()) }), req.body);
      res.status(201).json(templates.importManifest(body.manifest as never));
    }),
  );

  r.get('/:id', asyncHandler(async (req, res) => res.json(templates.get(req.params.id))));

  r.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const body = parse(
        z.object({
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(1000).optional(),
          settings: settingsSchema.optional(),
        }),
        req.body,
      );
      res.json(templates.update(req.params.id, body));
    }),
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      templates.delete(req.params.id);
      res.status(204).end();
    }),
  );

  r.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const manifest = templates.exportManifest(req.params.id);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${manifest.name.replace(/[^a-z0-9_-]+/gi, '_')}.mapgen.json"`,
      );
      res.send(JSON.stringify(manifest, null, 2));
    }),
  );

  return r;
}
