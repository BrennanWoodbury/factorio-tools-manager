import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  buildIconManifest,
  cacheKeyFor,
  referencedPaths,
  resolveIconPath,
  splitIconPath,
  type IconManifest,
} from './iconManifest.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

/**
 * On-disk cache of Factorio item/entity icons, keyed by game version.
 *
 * The headless image ships NO graphics at all (verified: zero PNGs), and
 * `--dump-icon-sprites` crashes without a video device, so icons cannot come from
 * the container. They are harvested once from a real Factorio install — either a
 * local one or a build downloaded with the user's own credentials — and cached
 * here. Game assets are never redistributed with this project; they are extracted
 * locally from a copy the user already owns, which is what every comparable tool
 * (FBSR, factorio-blueprint-editor) does.
 *
 * Keyed by version because `imageFor()` lets each server pin its own tag, so
 * several Factorio versions can be live at once. Version skew is real and not
 * theoretical: in 2.0.77 the recycler icon lives under `__quality__`, and by
 * 2.1.12 it has moved to its own mod. A dump from one version cannot be resolved
 * against another version's files.
 *
 * Layout:
 *   <dataDir>/icon-cache/<key>/manifest.json
 *   <dataDir>/icon-cache/<key>/icons/<mod>/<path...>.png
 *   <dataDir>/icon-cache/.tmp-<key>-<rand>/   (build in progress)
 *
 * Files mirror their mod-relative source path rather than being renamed per
 * prototype, so an icon shared by several prototypes (many rail pieces all draw
 * `rail.png`) is stored exactly once.
 */

export interface IconCacheStatus {
  key: string;
  version: string;
  mods: string[];
  iconCount: number;
  fileCount: number;
  bytes: number;
  generatedAt: string;
}

export interface BuildResult {
  key: string;
  /** Files actually copied into the cache. */
  copied: number;
  /** Source paths the manifest referenced but which were absent on disk. */
  missing: string[];
  bytes: number;
}

export class IconCache {
  constructor(private readonly rootDir: string) {}

  private get cacheRoot(): string {
    return path.join(this.rootDir, 'icon-cache');
  }

  dirFor(key: string): string {
    return path.join(this.cacheRoot, key);
  }

  private manifestPath(key: string): string {
    return path.join(this.dirFor(key), 'manifest.json');
  }

  /** A cache is usable only if its manifest landed — the last step of an atomic build. */
  has(key: string): boolean {
    return fs.existsSync(this.manifestPath(key));
  }

  /** Cache keys present on disk, newest build first. */
  list(): string[] {
    if (!fs.existsSync(this.cacheRoot)) return [];
    return fs
      .readdirSync(this.cacheRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.tmp-'))
      .map((d) => d.name)
      .filter((name) => this.has(name))
      .sort();
  }

  manifest(key: string): IconManifest {
    const p = this.manifestPath(key);
    if (!fs.existsSync(p)) throw new NotFoundError(`Icon cache '${key}'`);
    return JSON.parse(fs.readFileSync(p, 'utf8')) as IconManifest;
  }

  status(key: string): IconCacheStatus | undefined {
    if (!this.has(key)) return undefined;
    const m = this.manifest(key);
    let fileCount = 0;
    let bytes = 0;
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else {
          fileCount++;
          bytes += fs.statSync(full).size;
        }
      }
    };
    walk(path.join(this.dirFor(key), 'icons'));
    return {
      key,
      version: m.version,
      mods: m.mods,
      iconCount: Object.keys(m.icons).length,
      fileCount,
      bytes,
      generatedAt: m.generatedAt,
    };
  }

  /**
   * Absolute path to a prototype's icon file, or undefined if unknown.
   *
   * `layer` selects which layer of a multi-layer icon (barrels are an empty barrel
   * plus a tinted fluid overlay). Callers that do not composite should take layer
   * 0, which is the base artwork and recognisable on its own.
   */
  iconFileFor(key: string, name: string, layer = 0): string | undefined {
    if (!this.has(key)) return undefined;
    const entry = this.manifest(key).icons[name];
    const l = entry?.layers[layer];
    if (!l) return undefined;
    const rel = this.relPathFor(l.path);
    if (!rel) return undefined;
    const full = path.join(this.dirFor(key), 'icons', rel);
    return fs.existsSync(full) ? full : undefined;
  }

  /** `__base__/graphics/icons/rail.png` -> `base/graphics/icons/rail.png`. */
  private relPathFor(iconPath: string): string | undefined {
    const parts = splitIconPath(iconPath);
    return parts ? path.join(parts.mod, parts.rest) : undefined;
  }

  /**
   * Build (or rebuild) a cache from a Factorio `data` directory and its dump.
   *
   * Writes into a temp directory and renames on success, so a partially-built
   * cache is never visible and an interrupted build cannot corrupt a good one.
   * The previous cache stays in place until the replacement is complete.
   */
  build(opts: {
    dataRaw: unknown;
    /** Path to the install's `data` dir, containing `base/`, `core/`, … */
    dataDir: string;
    version: string;
    mods?: string[];
  }): BuildResult {
    if (!fs.existsSync(opts.dataDir)) {
      throw new ValidationError(`Factorio data directory not found: ${opts.dataDir}`);
    }

    const manifest = buildIconManifest(opts.dataRaw, {
      version: opts.version,
      mods: opts.mods,
    });
    const key = cacheKeyFor(manifest.version, manifest.mods);

    fs.mkdirSync(this.cacheRoot, { recursive: true });
    const tmp = path.join(this.cacheRoot, `.tmp-${key}-${randomBytes(4).toString('hex')}`);
    fs.mkdirSync(path.join(tmp, 'icons'), { recursive: true });

    const missing: string[] = [];
    let copied = 0;
    let bytes = 0;

    try {
      for (const iconPath of referencedPaths(manifest)) {
        const src = resolveIconPath(iconPath, opts.dataDir);
        const rel = this.relPathFor(iconPath);
        if (!src || !rel) {
          missing.push(iconPath);
          continue;
        }
        if (!fs.existsSync(src)) {
          // Expected when a dump and an install disagree (different versions, or a
          // mod present in one and not the other). Recorded, never fatal.
          missing.push(iconPath);
          continue;
        }
        const dest = path.join(tmp, 'icons', rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        copied++;
        bytes += fs.statSync(dest).size;
      }

      // Manifest last: `has()` keys off it, so the cache only becomes visible once
      // every icon is already in place.
      fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));

      const final = this.dirFor(key);
      const replaced = fs.existsSync(final)
        ? path.join(this.cacheRoot, `.tmp-old-${key}-${randomBytes(4).toString('hex')}`)
        : undefined;
      if (replaced) fs.renameSync(final, replaced);
      fs.renameSync(tmp, final);
      if (replaced) fs.rmSync(replaced, { recursive: true, force: true });

      return { key, copied, missing, bytes };
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * Delete caches whose key is not in `keep`. Never removes the newest surviving
   * cache even if unreferenced, so there is always something to render with.
   */
  prune(keep: Set<string>): string[] {
    const present = this.list();
    const removable = present.filter((k) => !keep.has(k));
    if (removable.length === present.length && present.length > 0) {
      // Everything is unreferenced — keep the most recent as a fallback.
      removable.sort();
      removable.pop();
    }
    for (const key of removable) {
      fs.rmSync(this.dirFor(key), { recursive: true, force: true });
    }
    return removable;
  }

  /** Remove abandoned temp dirs left by an interrupted build. */
  cleanTemp(): number {
    if (!fs.existsSync(this.cacheRoot)) return 0;
    let n = 0;
    for (const e of fs.readdirSync(this.cacheRoot, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.startsWith('.tmp-')) {
        fs.rmSync(path.join(this.cacheRoot, e.name), { recursive: true, force: true });
        n++;
      }
    }
    return n;
  }
}
