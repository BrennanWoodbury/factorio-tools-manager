import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { buildContext } from './context.js';
import { authRouter } from './routes/auth.js';
import { serversRouter } from './routes/servers.js';
import { systemRouter } from './routes/system.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

async function main() {
  const ctx = buildContext(config);

  // Best-effort startup reconcile: align each server's stored status with the
  // actual container state (containers may have been started/stopped/crashed
  // while the manager was down).
  try {
    for (const row of ctx.repo.list()) {
      const cs = await ctx.docker.status(row.id);
      const status = cs.running ? 'running' : 'stopped';
      if (row.status !== status) ctx.repo.setStatus(row.id, status);
    }
  } catch (err) {
    console.warn(`[startup] status reconcile skipped: ${(err as Error).message}`);
  }

  ctx.ddns.start();

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Unauthenticated auth endpoints.
  app.use('/api/auth', authRouter(ctx));
  // Everything else under /api requires a valid session.
  app.use('/api', requireAuth(config));
  app.use('/api/servers', serversRouter(ctx));
  app.use('/api/system', systemRouter(ctx));

  // Serve the built SPA if present (single-container deployment).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const spaDir = path.resolve(here, '../../frontend/dist');
  if (fs.existsSync(spaDir)) {
    app.use(express.static(spaDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(spaDir, 'index.html'));
    });
  }

  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    console.log(`[factorio-manager] listening on :${config.port}`);
    console.log(`[factorio-manager] DNS ${ctx.dns.enabled ? 'enabled' : 'disabled'}, ` +
      `game ports ${config.gamePortRange.join('-')}, rcon ${config.rconPortRange.join('-')}`);
  });

  const shutdown = async () => {
    console.log('[factorio-manager] shutting down');
    ctx.ddns.stop();
    await ctx.rcon.disconnectAll();
    server.close();
    ctx.db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[factorio-manager] fatal:', err);
  process.exit(1);
});
