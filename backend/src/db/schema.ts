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
  factorio_username   TEXT NOT NULL DEFAULT '',
  factorio_token      TEXT NOT NULL DEFAULT '',
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

-- Shared, reusable mod collections (a local registry). A modpack is just a
-- manifest — mod names + enabled flags + optional pinned versions. It stores no
-- mod binaries and no credentials; servers download the actual zips at apply time
-- using their own mod-portal credentials.
CREATE TABLE IF NOT EXISTS modpacks (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL DEFAULT '',
  factorio_version TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS modpack_mods (
  modpack_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  version    TEXT,                 -- NULL = "latest"
  PRIMARY KEY (modpack_id, name),
  FOREIGN KEY (modpack_id) REFERENCES modpacks(id) ON DELETE CASCADE
);
`;
