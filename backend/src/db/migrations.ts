import type { DB } from './index.js';

/**
 * Incremental schema migrations, gated by SQLite's `PRAGMA user_version`.
 *
 * `schema.ts` creates any missing table (idempotent CREATE IF NOT EXISTS) and is
 * applied first. Migrations here handle changes that CREATE-IF-NOT-EXISTS can't
 * express — chiefly `ALTER TABLE ... ADD COLUMN` — and run in order, each bumping
 * user_version so they apply exactly once per database.
 */
interface Migration {
  version: number;
  up: (db: DB) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    // Full editable server-settings.json body (advanced fields only; name /
    // description / max_players stay on the row and are overlaid at write time).
    up: (db) => db.exec('ALTER TABLE servers ADD COLUMN settings_json TEXT'),
  },
  {
    version: 2,
    // Which modpack a server was last given (for display + "re-apply"). Not a FK
    // (SQLite can't ADD COLUMN with a FK); referential cleanup is done in code.
    up: (db) => db.exec('ALTER TABLE servers ADD COLUMN applied_modpack_id TEXT'),
  },
  {
    version: 3,
    // Rename the factorio.com account credential columns: the same username/token
    // is used both for mod-portal downloads AND public-server listing, so the
    // mod-centric name was misleading. Guarded so it's a no-op on fresh DBs (where
    // schema.ts already creates the new names).
    up: (db) => {
      const cols = db.prepare<{ name: string }>('PRAGMA table_info(servers)').all();
      const has = (n: string) => cols.some((c) => c.name === n);
      if (has('mod_portal_username') && !has('factorio_username')) {
        db.exec('ALTER TABLE servers RENAME COLUMN mod_portal_username TO factorio_username');
      }
      if (has('mod_portal_token') && !has('factorio_token')) {
        db.exec('ALTER TABLE servers RENAME COLUMN mod_portal_token TO factorio_token');
      }
    },
  },
  {
    version: 4,
    // Per-server player whitelist (JSON array of Factorio usernames). The global
    // whitelist lives in the kv table; the effective whitelist written to
    // server-whitelist.json on start is the union of the two.
    up: (db) => db.exec('ALTER TABLE servers ADD COLUMN whitelist_json TEXT'),
  },
  {
    version: 5,
    // Per-server Factorio image tag (e.g. 'stable', 'latest', '2.0.55'). Empty =>
    // use the global FACTORIO_IMAGE. Applied to the base repo of FACTORIO_IMAGE.
    up: (db) => db.exec('ALTER TABLE servers ADD COLUMN factorio_tag TEXT'),
  },
  {
    version: 6,
    // When 1, a restart-requiring config change made while the server is running
    // triggers an automatic restart to apply it.
    up: (db) => db.exec('ALTER TABLE servers ADD COLUMN auto_restart INTEGER NOT NULL DEFAULT 0'),
  },
  {
    version: 7,
    // Per-server admin list (JSON array of Factorio usernames). Global admin list
    // lives in kv; the effective admin list written to server-adminlist.json on
    // start is the union of the two (mirrors the whitelist).
    up: (db) => db.exec('ALTER TABLE servers ADD COLUMN adminlist_json TEXT'),
  },
  {
    version: 8,
    // The user's intended run state ('running' | 'stopped'), set by start/stop and
    // NOT overwritten by observed-status updates. On manager startup, servers whose
    // desired_state is 'running' but whose container isn't are resumed.
    up: (db) => db.exec("ALTER TABLE servers ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'stopped'"),
  },
  {
    version: 9,
    // Scheduled backup config per server.
    up: (db) => {
      db.exec('ALTER TABLE servers ADD COLUMN auto_backup INTEGER NOT NULL DEFAULT 0');
      db.exec('ALTER TABLE servers ADD COLUMN backup_interval_minutes INTEGER NOT NULL DEFAULT 60');
      db.exec('ALTER TABLE servers ADD COLUMN backup_keep INTEGER NOT NULL DEFAULT 10');
    },
  },
];

export function runMigrations(db: DB): void {
  const row = db.prepare<{ user_version: number }>('PRAGMA user_version').get();
  const current = row?.user_version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      // user_version can't be parameterised; version is an integer literal we control.
      db.exec(`PRAGMA user_version = ${m.version}`);
    })();
    console.log(`[db] applied migration v${m.version}`);
  }
}

/** Highest known migration version (for tests / sanity). */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
