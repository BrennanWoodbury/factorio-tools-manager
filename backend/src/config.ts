import path from 'node:path';

/**
 * Central runtime configuration, sourced entirely from environment variables so
 * the whole stack is configured via docker-compose / .env. See README for the
 * meaning of each var and the required Cloudflare token permissions.
 */

function req(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function intOpt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}

/** Parse a range like "34197-34297" into [start, end] inclusive. */
function parseRange(name: string, fallback: string): [number, number] {
  const raw = opt(name, fallback);
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(raw.trim());
  if (!m) throw new Error(`Environment variable ${name} must look like "34197-34297"`);
  const start = Number.parseInt(m[1], 10);
  const end = Number.parseInt(m[2], 10);
  if (start > end) throw new Error(`Environment variable ${name}: range start must be <= end`);
  return [start, end];
}

// DNS automation is optional so the app can run in a pure-local/dev mode where
// you connect by IP:port. When CLOUDFLARE_API_TOKEN is unset, DNS + DDNS are
// disabled and server records simply aren't created.
const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
const dnsEnabled = cloudflareToken !== '';

export const config = {
  port: intOpt('PORT', 8080),
  dataDir: path.resolve(opt('DATA_DIR', path.resolve(process.cwd(), '../data'))),
  dbPath: opt('DB_PATH', path.resolve(opt('DATA_DIR', path.resolve(process.cwd(), '../data')), 'manager.db')),

  // Auth for the web UI. adminPassword gates login; jwtSecret signs the session.
  adminPassword: req('ADMIN_PASSWORD'),
  jwtSecret: opt('JWT_SECRET', 'change-me-please-' + req('ADMIN_PASSWORD')),

  // The pre-forwarded, contiguous UDP game-port range. The allocator NEVER hands
  // out a port outside this range because ports outside it are not forwarded.
  gamePortRange: parseRange('GAME_PORT_RANGE', '34197-34297'),
  // RCON ports are loopback-only, never forwarded, never in DNS. Separate range.
  rconPortRange: parseRange('RCON_PORT_RANGE', '27015-27115'),

  // Docker
  dockerSocket: opt('DOCKER_SOCKET', '/var/run/docker.sock'),
  factorioImage: opt('FACTORIO_IMAGE', 'factoriotools/factorio:stable'),
  // Shared user-defined bridge network that the manager and every Factorio
  // container join, so the manager can reach RCON over the Docker network.
  factorioNetwork: opt('FACTORIO_NETWORK', 'factorio-net'),
  // PUID/PGID passed to the Factorio image so bind-mounted data-dir files are
  // owned by a matching host user. Empty => use the image default.
  puid: opt('PUID', ''),
  pgid: opt('PGID', ''),
  // How the backend reaches a server's RCON:
  //  - 'network'  : connect to <containerName>:27015 over factorioNetwork
  //                 (correct when the manager runs as a container). Default.
  //  - 'loopback' : connect to 127.0.0.1:<rconPort> (correct for local dev with
  //                 the backend running directly on the host).
  rconMode: opt('RCON_MODE', 'network') as 'network' | 'loopback',
  // Absolute path to the servers data dir *as seen by the Docker daemon (the host)*.
  // When the manager runs in a container, its own DATA_DIR is a mount, but the
  // Factorio containers it spawns are bind-mounted from the host path. These can
  // differ, so it's configured explicitly. Defaults to DATA_DIR/servers.
  hostServersDir: opt('HOST_SERVERS_DIR', path.resolve(opt('DATA_DIR', path.resolve(process.cwd(), '../data')), 'servers')),

  // DNS / DDNS (Cloudflare)
  dnsEnabled,
  cloudflareToken,
  cloudflareZoneId: opt('CLOUDFLARE_ZONE_ID', ''),
  baseDomain: opt('BASE_DOMAIN', ''), // e.g. mydomain.com
  hostRecordName: opt('HOST_RECORD_NAME', ''), // e.g. host.mydomain.com (SRV target + A record)
  ddnsIntervalMs: intOpt('DDNS_INTERVAL_SECONDS', 300) * 1000,
  ipCheckUrl: opt('IP_CHECK_URL', 'https://api.ipify.org'),
} as const;

export type AppConfig = typeof config;

/** Directory (as the manager process sees it) holding all per-server data dirs. */
export const serversDir = path.resolve(config.dataDir, 'servers');
