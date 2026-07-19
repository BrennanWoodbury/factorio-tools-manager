/**
 * SQLite schema. Applied idempotently on startup (see db.ts).
 *
 * Design notes:
 * - `servers` is the source of truth for a server's identity/config.
 * - `port_allocations` is a dedicated registry so a port claim is a single
 *   atomic INSERT guarded by a UNIQUE primary key. This makes double-allocation
 *   impossible even under concurrent create requests: two inserts of the same
 *   (kind, port) cannot both succeed. Game and RCON ports live in the same table
 *   but are namespaced by `kind` since they come from disjoint ranges.
 * - `dns_records` is bookkeeping so we can reconcile / clean up Cloudflare records
 *   by their Cloudflare record id, and survive a restart mid-operation.
 * - `kv` holds small singletons (e.g. last-known public IP, the host A-record id).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS servers (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  subdomain         TEXT NOT NULL UNIQUE,
  description       TEXT NOT NULL DEFAULT '',
  max_players       INTEGER NOT NULL DEFAULT 0,
  game_port         INTEGER NOT NULL,
  rcon_port         INTEGER NOT NULL,
  rcon_password     TEXT NOT NULL,
  save_name         TEXT NOT NULL DEFAULT 'default',
  generate_new_save INTEGER NOT NULL DEFAULT 1,
  mod_portal_username TEXT NOT NULL DEFAULT '',
  mod_portal_token    TEXT NOT NULL DEFAULT '',
  container_id      TEXT,
  status            TEXT NOT NULL DEFAULT 'stopped',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS port_allocations (
  kind         TEXT NOT NULL CHECK (kind IN ('game','rcon')),
  port         INTEGER NOT NULL,
  server_id    TEXT NOT NULL,
  allocated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, port),
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_port_alloc_server ON port_allocations(server_id);

CREATE TABLE IF NOT EXISTS dns_records (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id            TEXT,
  type                 TEXT NOT NULL,          -- 'SRV' | 'A'
  name                 TEXT NOT NULL,          -- fully-qualified record name
  cloudflare_record_id TEXT,                   -- id returned by Cloudflare
  content              TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dns_server ON dns_records(server_id);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
