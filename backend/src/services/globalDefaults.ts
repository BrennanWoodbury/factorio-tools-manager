import { kvGet, kvSet, type DB } from '../db/index.js';
import { ValidationError } from '../lib/errors.js';

/**
 * Global server defaults with per-server override. Each scalar "cascading" setting
 * has a global default (kv) plus, on every server, a value column and an
 * `<col>_overridden` flag. A server whose flag is 0 tracks the global — changing
 * the global pushes the new value into its row; a server whose flag is 1 is frozen
 * until reset. New servers are seeded from the global with the flag 0 (inheriting).
 *
 * modpackId / mapTemplateId are *creation* defaults (snapshot-at-create), not
 * cascading — they pre-fill a new server and are then owned by it.
 */
export interface GlobalDefaults {
  autoRestart: boolean;
  autoBackup: boolean;
  backupIntervalMinutes: number;
  backupKeep: number;
  backupKeepManual: number;
  modpackId: string | null;
  mapTemplateId: string | null;
}

/** One cascading scalar setting: how it maps between API, kv and server columns. */
export interface CascadeDef {
  key: 'autoRestart' | 'autoBackup' | 'backupIntervalMinutes' | 'backupKeep' | 'backupKeepManual';
  kv: string;
  col: string; // server value column
  ovr: string; // server "<col>_overridden" flag column
  type: 'bool' | 'int';
  fallback: number; // hard-coded default (bool as 0/1) when the global is unset
  min?: number;
}

export const CASCADE: CascadeDef[] = [
  { key: 'autoRestart', kv: 'default_auto_restart', col: 'auto_restart', ovr: 'auto_restart_overridden', type: 'bool', fallback: 0 },
  { key: 'autoBackup', kv: 'default_auto_backup', col: 'auto_backup', ovr: 'auto_backup_overridden', type: 'bool', fallback: 0 },
  { key: 'backupIntervalMinutes', kv: 'default_backup_interval_minutes', col: 'backup_interval_minutes', ovr: 'backup_interval_minutes_overridden', type: 'int', fallback: 15, min: 5 },
  { key: 'backupKeep', kv: 'default_backup_keep', col: 'backup_keep', ovr: 'backup_keep_overridden', type: 'int', fallback: 10, min: 1 },
  { key: 'backupKeepManual', kv: 'default_backup_keep_manual', col: 'backup_keep_manual', ovr: 'backup_keep_manual_overridden', type: 'int', fallback: 10, min: 1 },
];

const KV_MODPACK = 'default_modpack_id';
const KV_MAP_TEMPLATE = 'default_map_template_id';

/** The stored numeric column value a cascading global resolves to (clamped/normalised). */
export function globalColumnValue(db: DB, def: CascadeDef): number {
  const raw = Number(kvGet(db, def.kv));
  const v = Number.isFinite(raw) && kvGet(db, def.kv) !== null ? raw : def.fallback;
  return def.type === 'bool' ? (v ? 1 : 0) : Math.max(def.min ?? 0, Math.floor(v));
}

export function getGlobalDefaults(db: DB): GlobalDefaults {
  const val = (key: CascadeDef['key']) => globalColumnValue(db, CASCADE.find((d) => d.key === key)!);
  return {
    autoRestart: val('autoRestart') === 1,
    autoBackup: val('autoBackup') === 1,
    backupIntervalMinutes: val('backupIntervalMinutes'),
    backupKeep: val('backupKeep'),
    backupKeepManual: val('backupKeepManual'),
    modpackId: kvGet(db, KV_MODPACK) || null,
    mapTemplateId: kvGet(db, KV_MAP_TEMPLATE) || null,
  };
}

/**
 * Set global defaults. For each changed cascading setting, persist it and push the
 * new value into every server that is inheriting it (`<ovr> = 0`). modpack/template
 * defaults are stored only (creation-time, never pushed).
 */
export function setGlobalDefaults(db: DB, patch: Partial<GlobalDefaults>): void {
  for (const def of CASCADE) {
    const v = patch[def.key];
    if (v === undefined) continue;
    const num = def.type === 'bool' ? (v ? 1 : 0) : Math.max(def.min ?? 0, Math.floor(Number(v)));
    kvSet(db, def.kv, String(num));
    // Column names come from the CASCADE constant, never user input.
    db.prepare(`UPDATE servers SET ${def.col} = ? WHERE ${def.ovr} = 0`).run(num);
  }
  if (patch.modpackId !== undefined) kvSet(db, KV_MODPACK, patch.modpackId ?? '');
  if (patch.mapTemplateId !== undefined) kvSet(db, KV_MAP_TEMPLATE, patch.mapTemplateId ?? '');
}

/** Column values (+ overridden flags = 0) to seed a new server from the current globals. */
export function seedCascadeColumns(db: DB): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of CASCADE) {
    out[def.col] = globalColumnValue(db, def);
    out[def.ovr] = 0;
  }
  return out;
}

/** Reset one server setting back to inheriting the global (value = global, flag = 0). */
export function resetServerSetting(db: DB, serverId: string, key: string): void {
  const def = CASCADE.find((d) => d.key === key);
  if (!def) throw new ValidationError(`Unknown setting "${key}"`);
  db.prepare(`UPDATE servers SET ${def.col} = ?, ${def.ovr} = 0 WHERE id = ?`).run(
    globalColumnValue(db, def),
    serverId,
  );
}

/** UI-facing view (adds resolved modpack/template names when provided). */
export function globalDefaultsDto(
  db: DB,
  names?: { modpackName?: string | null; mapTemplateName?: string | null },
) {
  const g = getGlobalDefaults(db);
  return {
    ...g,
    modpackName: names?.modpackName ?? null,
    mapTemplateName: names?.mapTemplateName ?? null,
  };
}
