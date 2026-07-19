import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { toDto } from '../db/models.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError } from '../lib/errors.js';
import { sanitizeName } from '../services/serverFiles.js';
import { serverFiles } from '../services/serverFiles.js';

const modEntrySchema = z.object({ name: z.string().min(1), enabled: z.boolean() });

const createSchema = z.object({
  name: z.string().min(1).max(100),
  subdomain: z.string().min(1).max(63),
  maxPlayers: z.number().int().min(0).max(500).optional(),
  description: z.string().max(1000).optional(),
  saveName: z.string().max(100).optional(),
  generateNewSave: z.boolean().optional(),
  modPortalUsername: z.string().max(100).optional(),
  modPortalToken: z.string().max(200).optional(),
  mods: z.array(modEntrySchema).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subdomain: z.string().min(1).max(63).optional(),
  maxPlayers: z.number().int().min(0).max(500).optional(),
  description: z.string().max(1000).optional(),
  saveName: z.string().max(100).optional(),
  generateNewSave: z.boolean().optional(),
  modPortalUsername: z.string().max(100).optional(),
  modPortalToken: z.string().max(200).optional(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
}

export function serversRouter(ctx: AppContext): Router {
  const r = Router();
  const { manager, mods } = ctx;
  // Save files can be large; cap at 1 GiB and buffer in memory (single-host tool).
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

  const dtoOf = (row: Parameters<typeof toDto>[0]) => toDto(row, manager.connectHost(row));

  // ---- CRUD ----

  r.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ servers: manager.list().map(dtoOf) });
    }),
  );

  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = parse(createSchema, req.body);
      const row = await manager.create(input);
      res.status(201).json({ server: dtoOf(row) });
    }),
  );

  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      res.json({ server: dtoOf(row) });
    }),
  );

  r.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const input = parse(updateSchema, req.body);
      const row = await manager.update(req.params.id, input);
      res.json({ server: dtoOf(row) });
    }),
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await manager.delete(req.params.id);
      res.status(204).end();
    }),
  );

  // ---- Lifecycle ----

  r.post(
    '/:id/start',
    asyncHandler(async (req, res) => {
      await manager.start(req.params.id);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/:id/stop',
    asyncHandler(async (req, res) => {
      await manager.stop(req.params.id);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/:id/restart',
    asyncHandler(async (req, res) => {
      await manager.restart(req.params.id);
      res.json({ ok: true });
    }),
  );

  r.get(
    '/:id/status',
    asyncHandler(async (req, res) => {
      res.json(await manager.status(req.params.id));
    }),
  );

  r.get(
    '/:id/logs',
    asyncHandler(async (req, res) => {
      manager.get(req.params.id); // 404 if unknown
      const tail = Math.min(Number(req.query.tail) || 200, 2000);
      const logs = await ctx.docker.logs(req.params.id, tail);
      res.json({ logs });
    }),
  );

  // ---- Advanced server settings (full server-settings.json body) ----

  r.get(
    '/:id/settings',
    asyncHandler(async (req, res) => {
      res.json({ settings: manager.getSettings(req.params.id) });
    }),
  );

  r.put(
    '/:id/settings',
    asyncHandler(async (req, res) => {
      const body = parse(z.object({ settings: z.record(z.string(), z.unknown()) }), req.body);
      const settings = manager.updateSettings(req.params.id, body.settings);
      res.json({ settings });
    }),
  );

  // ---- Saves ----

  r.get(
    '/:id/saves',
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      res.json({ saves: serverFiles.listSaves(row.id), selected: row.save_name });
    }),
  );

  r.post(
    '/:id/saves',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      if (!req.file) throw new ValidationError('Expected a multipart file field named "file"');
      const rawName = (req.body?.name as string) || req.file.originalname;
      const name = sanitizeName(rawName);
      serverFiles.writeSave(row.id, name, req.file.buffer);
      res.status(201).json({ saves: serverFiles.listSaves(row.id) });
    }),
  );

  r.get(
    '/:id/saves/:name/download',
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      const name = sanitizeName(req.params.name);
      const buf = serverFiles.readSave(row.id, name);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
      res.send(buf);
    }),
  );

  r.post(
    '/:id/saves/:name/select',
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      const name = sanitizeName(req.params.name);
      if (!serverFiles.saveExists(row.id, name)) throw new ValidationError(`No such save "${name}"`);
      // Selecting an existing save means: load it, don't generate a new one.
      const updated = await manager.update(row.id, { saveName: name, generateNewSave: false });
      res.json({ server: toDto(updated, manager.connectHost(updated)) });
    }),
  );

  r.delete(
    '/:id/saves/:name',
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      const name = sanitizeName(req.params.name);
      serverFiles.deleteSave(row.id, name);
      res.status(204).end();
    }),
  );

  // ---- Mods ----

  r.get(
    '/:id/mods',
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      res.json({ mods: mods.getModList(row.id) });
    }),
  );

  r.put(
    '/:id/mods',
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      const body = parse(z.object({ mods: z.array(modEntrySchema) }), req.body);
      const result = await mods.applyModList(row, body.mods);
      res.json({ mods: mods.getModList(row.id), ...result });
    }),
  );

  // ---- RCON ----

  r.post(
    '/:id/rcon',
    asyncHandler(async (req, res) => {
      const row = manager.get(req.params.id);
      const body = parse(z.object({ command: z.string().min(1).max(2000) }), req.body);
      const response = await ctx.rcon.send(row, body.command);
      res.json({ response });
    }),
  );

  return r;
}
