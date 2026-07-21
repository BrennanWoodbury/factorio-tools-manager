import fs from 'node:fs';
import path from 'node:path';
import { serversDir, config } from '../config.js';
import type { ServerRow } from '../db/models.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

export interface ModEntry {
  name: string;
  enabled: boolean;
  version?: string;
}

/**
 * Manages the on-disk data directory for each server. The manager reads/writes
 * via its own local mount (`serversDir/<id>`); the *same* directory is bind-
 * mounted into the Factorio container at `/factorio` using the host path
 * (`config.hostServersDir/<id>`), which is what DockerService receives.
 *
 * Layout (mirrors what the factoriotools image expects under /factorio):
 *   <id>/saves/         *.zip save files
 *   <id>/mods/          mod-list.json + downloaded mod zips
 *   <id>/config/        server-settings.json
 */
export class ServerFilesService {
  localDir(serverId: string): string {
    return path.join(serversDir, serverId);
  }

  /** Path as the Docker daemon sees it, for the bind mount. */
  hostDir(serverId: string): string {
    return path.join(config.hostServersDir, serverId);
  }

  savesDir(serverId: string): string {
    return path.join(this.localDir(serverId), 'saves');
  }

  modsDir(serverId: string): string {
    return path.join(this.localDir(serverId), 'mods');
  }

  configDir(serverId: string): string {
    return path.join(this.localDir(serverId), 'config');
  }

  ensureDirs(serverId: string): void {
    for (const d of [this.savesDir(serverId), this.modsDir(serverId), this.configDir(serverId)]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  removeAll(serverId: string): void {
    fs.rmSync(this.localDir(serverId), { recursive: true, force: true });
  }

  /**
   * The three fields the manager keeps on the server row (edited via the basic
   * settings form). They are ALWAYS overlaid onto the advanced settings at write
   * time, so there is exactly one source of truth per field and no drift.
   */
  static readonly MANAGED_KEYS = ['name', 'description', 'max_players'] as const;

  /** Advanced server-settings defaults (everything except the managed keys). */
  defaultAdvancedSettings(): Record<string, unknown> {
    return {
      tags: ['factorio-manager'],
      visibility: { public: false, lan: true },
      require_user_verification: true,
      max_upload_in_kilobytes_per_second: 0,
      max_upload_slots: 5,
      minimum_latency_in_ticks: 0,
      game_password: '',
      // Factorio 2.x spelling is "admins-only" (1.x used "admin-only"); the wrong
      // value makes the server refuse to start ("Invalid value ... AllowedCommands").
      allow_commands: 'admins-only',
      autosave_interval: 10,
      autosave_slots: 5,
      afk_autokick_interval: 0,
      auto_pause: true,
      only_admins_can_pause_the_game: true,
      autosave_only_on_server: true,
    };
  }

  /** Stored advanced settings for a server (defaults filled), managed keys removed. */
  getAdvancedSettings(server: ServerRow): Record<string, unknown> {
    let stored: Record<string, unknown> = {};
    if (server.settings_json) {
      try {
        stored = JSON.parse(server.settings_json) as Record<string, unknown>;
      } catch {
        stored = {};
      }
    }
    const merged = { ...this.defaultAdvancedSettings(), ...stored };
    for (const k of ServerFilesService.MANAGED_KEYS) delete merged[k];
    return merged;
  }

  /** The effective server-settings.json body: advanced ⊕ managed row fields. */
  effectiveSettings(server: ServerRow): Record<string, unknown> {
    return {
      ...this.getAdvancedSettings(server),
      name: server.name,
      description: server.description,
      max_players: server.max_players,
    };
  }

  /** Write server-settings.json from the server row. Called before each start. */
  writeServerSettings(server: ServerRow): void {
    this.ensureDirs(server.id);
    fs.writeFileSync(
      path.join(this.configDir(server.id), 'server-settings.json'),
      JSON.stringify(this.effectiveSettings(server), null, 2),
    );
  }

  // ---- RCON password ----

  rconPasswordPath(serverId: string): string {
    return path.join(this.configDir(serverId), 'rconpw');
  }

  /**
   * Write the RCON password to config/rconpw. The factoriotools image reads its
   * RCON password from this file (auto-generating one only if absent) and ignores
   * the RCON_PASSWORD env var, so we must write it ourselves for the manager's
   * stored password to match what the server actually uses.
   */
  writeRconPassword(serverId: string, password: string): void {
    this.ensureDirs(serverId);
    fs.writeFileSync(this.rconPasswordPath(serverId), password);
  }

  // ---- Whitelist ----

  whitelistPath(serverId: string): string {
    return path.join(this.configDir(serverId), 'server-whitelist.json');
  }

  /**
   * Write the effective player whitelist to config/server-whitelist.json. The
   * factoriotools image enforces the whitelist whenever this file is present, so
   * we must NOT write it when the list is empty (that would block everyone) —
   * instead we remove any stale file, leaving the server open.
   */
  writeWhitelist(serverId: string, names: string[]): void {
    const path_ = this.whitelistPath(serverId);
    if (names.length === 0) {
      if (fs.existsSync(path_)) fs.rmSync(path_);
      return;
    }
    this.ensureDirs(serverId);
    fs.writeFileSync(path_, JSON.stringify(names, null, 2));
  }

  // ---- Backups ----

  backupsDir(serverId: string): string {
    return path.join(this.localDir(serverId), 'backups');
  }

  backupPath(serverId: string, backupName: string): string {
    return path.join(this.backupsDir(serverId), `${sanitizeName(backupName)}.zip`);
  }

  /** Newest save by mtime, or undefined if there are none. */
  latestSaveName(serverId: string): string | undefined {
    return this.listSaves(serverId)[0]?.name; // listSaves is sorted newest-first
  }

  /**
   * Copy a save into backups/ as `<save>__<timestamp>.zip`. Returns the backup name.
   * The `<save>__` prefix lets restore recover the original save name.
   */
  backupSave(serverId: string, saveName: string): string {
    const src = this.savePath(serverId, saveName);
    if (!fs.existsSync(src)) throw new NotFoundError(`Save "${saveName}"`);
    fs.mkdirSync(this.backupsDir(serverId), { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${sanitizeName(saveName)}__${ts}`;
    fs.copyFileSync(src, this.backupPath(serverId, name));
    return name;
  }

  listBackups(serverId: string): { name: string; source: string; sizeBytes: number; createdAt: string }[] {
    const dir = this.backupsDir(serverId);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => {
        const name = f.replace(/\.zip$/, '');
        const stat = fs.statSync(path.join(dir, f));
        return {
          name,
          source: name.split('__')[0],
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  readBackup(serverId: string, backupName: string): Buffer {
    const p = this.backupPath(serverId, backupName);
    if (!fs.existsSync(p)) throw new NotFoundError(`Backup "${backupName}"`);
    return fs.readFileSync(p);
  }

  deleteBackup(serverId: string, backupName: string): void {
    const p = this.backupPath(serverId, backupName);
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  /** Copy a backup into saves/ under its original save name. Returns that name. */
  restoreBackup(serverId: string, backupName: string): string {
    const p = this.backupPath(serverId, backupName);
    if (!fs.existsSync(p)) throw new NotFoundError(`Backup "${backupName}"`);
    const source = sanitizeName(backupName.split('__')[0] || backupName);
    this.ensureDirs(serverId);
    fs.copyFileSync(p, this.savePath(serverId, source));
    return source;
  }

  /** Keep only the newest `keep` backups; delete the rest. */
  pruneBackups(serverId: string, keep: number): number {
    if (keep <= 0) return 0;
    const backups = this.listBackups(serverId); // newest-first
    const stale = backups.slice(keep);
    for (const b of stale) this.deleteBackup(serverId, b.name);
    return stale.length;
  }

  // ---- Admin list ----

  adminlistPath(serverId: string): string {
    return path.join(this.configDir(serverId), 'server-adminlist.json');
  }

  /** Write the effective admin list to config/server-adminlist.json (empty removes it). */
  writeAdminlist(serverId: string, names: string[]): void {
    const p = this.adminlistPath(serverId);
    if (names.length === 0) {
      if (fs.existsSync(p)) fs.rmSync(p);
      return;
    }
    this.ensureDirs(serverId);
    fs.writeFileSync(p, JSON.stringify(names, null, 2));
  }

  // ---- Saves ----

  listSaves(serverId: string): { name: string; sizeBytes: number; modifiedAt: string }[] {
    const dir = this.savesDir(serverId);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => {
        const stat = fs.statSync(path.join(dir, f));
        return {
          name: f.replace(/\.zip$/, ''),
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  savePath(serverId: string, saveName: string): string {
    const safe = sanitizeName(saveName);
    return path.join(this.savesDir(serverId), `${safe}.zip`);
  }

  saveExists(serverId: string, saveName: string): boolean {
    return fs.existsSync(this.savePath(serverId, saveName));
  }

  /** Persist an uploaded save buffer under the given name. */
  writeSave(serverId: string, saveName: string, data: Buffer): void {
    this.ensureDirs(serverId);
    fs.writeFileSync(this.savePath(serverId, saveName), data);
  }

  readSave(serverId: string, saveName: string): Buffer {
    const p = this.savePath(serverId, saveName);
    if (!fs.existsSync(p)) throw new NotFoundError(`Save "${saveName}"`);
    return fs.readFileSync(p);
  }

  deleteSave(serverId: string, saveName: string): void {
    const p = this.savePath(serverId, saveName);
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  // ---- Mods ----

  modListPath(serverId: string): string {
    return path.join(this.modsDir(serverId), 'mod-list.json');
  }

  readModList(serverId: string): ModEntry[] {
    const p = this.modListPath(serverId);
    if (!fs.existsSync(p)) return [{ name: 'base', enabled: true }];
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as { mods?: ModEntry[] };
      return parsed.mods ?? [{ name: 'base', enabled: true }];
    } catch {
      throw new ValidationError('mod-list.json is corrupt');
    }
  }

  writeModList(serverId: string, mods: ModEntry[]): void {
    this.ensureDirs(serverId);
    // Always keep base present so the game runs.
    if (!mods.some((m) => m.name === 'base')) {
      mods = [{ name: 'base', enabled: true }, ...mods];
    }
    fs.writeFileSync(
      this.modListPath(serverId),
      JSON.stringify({ mods: mods.map((m) => ({ name: m.name, enabled: m.enabled })) }, null, 2),
    );
  }
}

/** Prevent path traversal / illegal filename chars in user-supplied save names. */
export function sanitizeName(name: string): string {
  const trimmed = name.trim().replace(/\.zip$/i, '');
  if (!/^[A-Za-z0-9 _.-]+$/.test(trimmed) || trimmed.includes('..')) {
    throw new ValidationError(
      'Name may only contain letters, numbers, spaces, dot, dash and underscore',
    );
  }
  return trimmed;
}

export const serverFiles = new ServerFilesService();
