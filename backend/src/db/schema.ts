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

-- Shared, reusable map-generation presets (a local registry). A template is just a
-- named map-gen-settings.json object (ore/water/terrain sliders, etc.), selectable
-- when creating a server and exportable/shareable as a JSON manifest. Holds no
-- server reference — applying one copies its settings onto a server at create time.
CREATE TABLE IF NOT EXISTS map_gen_templates (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL,     -- the map-gen-settings.json object
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Blueprint library
--
-- A durable, cross-save index of every blueprint we have ever seen, so a
-- blueprint outlives the save (and the server) it was found in. Answering "which
-- game was that blueprint in?" is the entire point, so content lives in ONE row
-- and the places it was observed are separate rows pointing at it.
--
-- Storage follows git's blob/tree split:
--   * blueprint_blobs     - content, addressed by hash (the "blob")
--   * blueprint_children  - a book's ordered child hashes (the "tree")
-- Editing one blueprint inside a big book therefore writes one small blob plus a
-- new child list, not another copy of the whole book.
--
-- Identity is the sha256 of the CANONICALISED decoded JSON, never the raw base64:
-- zlib output is not guaranteed stable across Factorio versions, and hashing the
-- string directly would make a harmless re-compression look like a new version.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blueprint_blobs (
  hash          TEXT PRIMARY KEY,   -- sha256 of canonical decoded JSON
  kind          TEXT NOT NULL CHECK (kind IN
                  ('blueprint','blueprint_book','deconstruction_planner','upgrade_planner')),
  label         TEXT,               -- most blueprints are UNLABELLED; icons identify them
  icons_json    TEXT NOT NULL DEFAULT '[]',
  -- Full blueprint string. Kept for books and for any item that failed a
  -- decompose/re-encode round trip; otherwise re-encoded on demand from payload.
  string        TEXT,
  payload_json  TEXT,               -- canonical decoded envelope (NULL for books)
  entity_counts_json TEXT,          -- {entity_name: count} — basis of similarity scoring
  entity_total  INTEGER NOT NULL DEFAULT 0,
  tile_count    INTEGER NOT NULL DEFAULT 0,
  game_version  TEXT,               -- '2.1.12.2', decoded from the payload's u64
  byte_size     INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bp_blobs_kind  ON blueprint_blobs(kind);
CREATE INDEX IF NOT EXISTS idx_bp_blobs_label ON blueprint_blobs(label);

-- Ordered membership of a book. (book_hash, position) so a book may legitimately
-- contain the same blueprint twice.
CREATE TABLE IF NOT EXISTS blueprint_children (
  book_hash  TEXT NOT NULL,
  position   INTEGER NOT NULL,
  child_hash TEXT NOT NULL,
  PRIMARY KEY (book_hash, position),
  FOREIGN KEY (book_hash)  REFERENCES blueprint_blobs(hash) ON DELETE CASCADE,
  FOREIGN KEY (child_hash) REFERENCES blueprint_blobs(hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bp_children_child ON blueprint_children(child_hash);

-- Every observation of a blob. Identical content in two saves = one blob, two
-- sightings; that is what powers "also in 2 other saves". server_id is nullable
-- and ON DELETE SET NULL so deleting a server never destroys the blueprint —
-- orphaned sightings keep their collection label instead.
CREATE TABLE IF NOT EXISTS blueprint_sightings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hash         TEXT NOT NULL,
  server_id    TEXT,
  save_name    TEXT NOT NULL DEFAULT '',
  -- Where inside the save: 'player:Woody/inventory', 'steel-chest@[-142,88]', ...
  location     TEXT NOT NULL DEFAULT '',
  -- Slot address within its container, e.g. 'blueprint_book:Rail Standards/3:Item Load'.
  -- Same path + changed content = an edit; this is the version lineage key.
  path         TEXT NOT NULL DEFAULT '',
  -- User-supplied grouping for uploads with no server (saves carry no title or
  -- description of their own — verified against a real save's info.json).
  collection   TEXT,
  source       TEXT NOT NULL DEFAULT 'scan'
                 CHECK (source IN ('scan','upload','paste','backup')),
  seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hash)      REFERENCES blueprint_blobs(hash) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES servers(id)           ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bp_sight_hash   ON blueprint_sightings(hash);
CREATE INDEX IF NOT EXISTS idx_bp_sight_server ON blueprint_sightings(server_id);
CREATE INDEX IF NOT EXISTS idx_bp_sight_path   ON blueprint_sightings(server_id, path);
`;
