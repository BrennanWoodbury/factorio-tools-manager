import fs from 'node:fs';
import path from 'node:path';
import type { ServerRow } from '../db/models.js';
import { AppError, ValidationError } from '../lib/errors.js';
import { serverFiles, type ModEntry } from './serverFiles.js';

const MOD_PORTAL_BASE = 'https://mods.factorio.com';

interface ModRelease {
  version: string;
  download_url: string;
  file_name: string;
}
interface ModInfoResponse {
  name: string;
  releases?: ModRelease[];
}

/**
 * Mod management via the Factorio Mod Portal API.
 *
 * Why the API rather than the image's UPDATE_MODS_ON_START:
 *  - We can validate a mod name and surface "no such mod / download failed" to the
 *    UI *before* the container starts, instead of discovering it from a crash loop
 *    in container logs.
 *  - We control ordering and can remove stale versions deterministically.
 * Tradeoff: more code here, and we must handle Mod Portal auth ourselves (the
 * per-server portal username/token). Dependency resolution is intentionally out
 * of scope for the MVP — enabling a mod downloads that mod's latest release only.
 */
export class ModService {
  /** Look up a mod's latest release on the portal. */
  async latestRelease(name: string): Promise<ModRelease> {
    let res: Response;
    try {
      res = await fetch(`${MOD_PORTAL_BASE}/api/mods/${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new AppError(`Mod portal unreachable: ${(err as Error).message}`, 502, 'MOD_PORTAL');
    }
    if (res.status === 404) throw new ValidationError(`Mod "${name}" not found on the mod portal`);
    if (!res.ok) throw new AppError(`Mod portal HTTP ${res.status}`, 502, 'MOD_PORTAL');
    const info = (await res.json()) as ModInfoResponse;
    const releases = info.releases ?? [];
    if (releases.length === 0) throw new ValidationError(`Mod "${name}" has no releases`);
    return releases[releases.length - 1];
  }

  /** Download a mod's latest release zip into the server's mods dir. */
  async downloadMod(server: ServerRow, name: string): Promise<string> {
    if (!server.mod_portal_username || !server.mod_portal_token) {
      throw new ValidationError(
        'Mod portal credentials are required to download mods; set them on the server first',
      );
    }
    const release = await this.latestRelease(name);
    const url =
      `${MOD_PORTAL_BASE}${release.download_url}` +
      `?username=${encodeURIComponent(server.mod_portal_username)}` +
      `&token=${encodeURIComponent(server.mod_portal_token)}`;

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      throw new AppError(`Mod download failed: ${(err as Error).message}`, 502, 'MOD_PORTAL');
    }
    if (res.status === 403) {
      throw new ValidationError('Mod portal rejected credentials (check username/token)');
    }
    if (!res.ok) throw new AppError(`Mod download HTTP ${res.status}`, 502, 'MOD_PORTAL');

    const modsDir = serverFiles.modsDir(server.id);
    fs.mkdirSync(modsDir, { recursive: true });
    // Remove any previously-downloaded versions of this mod to avoid conflicts.
    for (const f of fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : []) {
      if (f.endsWith('.zip') && f.startsWith(`${name}_`)) fs.rmSync(path.join(modsDir, f));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(modsDir, release.file_name), buf);
    return release.version;
  }

  /**
   * Apply a desired mod list: write mod-list.json and download the zip for every
   * enabled non-base mod. Returns per-mod results so the caller/UI can report
   * partial failures without aborting the whole operation.
   */
  async applyModList(
    server: ServerRow,
    entries: ModEntry[],
  ): Promise<{ downloaded: { name: string; version: string }[]; errors: { name: string; error: string }[] }> {
    serverFiles.writeModList(server.id, entries);
    const downloaded: { name: string; version: string }[] = [];
    const errors: { name: string; error: string }[] = [];
    for (const entry of entries) {
      if (!entry.enabled || entry.name === 'base') continue;
      try {
        const version = await this.downloadMod(server, entry.name);
        downloaded.push({ name: entry.name, version });
      } catch (err) {
        errors.push({ name: entry.name, error: (err as Error).message });
      }
    }
    return { downloaded, errors };
  }

  getModList(serverId: string): ModEntry[] {
    return serverFiles.readModList(serverId);
  }
}

export const modService = new ModService();
