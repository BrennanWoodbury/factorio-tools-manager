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
      allow_commands: 'admin-only',
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
