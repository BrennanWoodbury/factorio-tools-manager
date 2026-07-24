import { ValidationError } from '../lib/errors.js';

/**
 * Turn Factorio's `data-raw-dump.json` into a slim prototype -> icon index.
 *
 * Two reasons this indirection exists rather than guessing filenames:
 *
 *  1. Icon paths are mod-relative (`__base__/graphics/icons/rail.png`) and only
 *     the dump knows which mod owns a prototype.
 *  2. The filename frequently does NOT match the prototype name — `straight-rail`
 *     is drawn by `rail.png`. Any name-based guess is wrong for a real fraction of
 *     the game.
 *
 * The raw dump is ~27 MB; the index we keep is a few hundred KB, and holds only
 * the categories a blueprint can actually reference.
 */

/** One layer of an icon. Most prototypes have exactly one. */
export interface IconLayer {
  /** Mod-relative source path, e.g. `__base__/graphics/icons/rail.png`. */
  path: string;
  size?: number;
  scale?: number;
  shift?: [number, number];
  tint?: { r?: number; g?: number; b?: number; a?: number };
}

export interface IconEntry {
  /** data.raw category the prototype was found in (`item`, `transport-belt`, …). */
  category: string;
  layers: IconLayer[];
}

/** name -> icon entry, plus provenance for cache invalidation. */
export interface IconManifest {
  /** Factorio version the dump came from, e.g. `2.1.12`. */
  version: string;
  /** Mod names present in the dump, so a modded cache key can include them. */
  mods: string[];
  generatedAt: string;
  icons: Record<string, IconEntry>;
}

/**
 * data.raw categories a blueprint can reference. Blueprints name entities, and
 * their icon slots reference items, fluids, virtual signals and quality. Recipes,
 * technologies, explosions, corpses and the like are irrelevant here and make up
 * most of the dump's bulk, so they are skipped.
 *
 * Entity categories are matched by suffix rather than listed exhaustively — the
 * set grows with every expansion, and a blueprint may contain any placeable.
 */
const SIGNAL_CATEGORIES = new Set([
  'item',
  'fluid',
  'virtual-signal',
  'quality',
  'item-with-entity-data',
  'rail-planner',
  'capsule',
  'module',
  'tool',
  'ammo',
  'armor',
  'gun',
  'repair-tool',
  'blueprint',
  'blueprint-book',
  'deconstruction-item',
  'upgrade-item',
  'spidertron-remote',
  'space-platform-starter-pack',
]);

/** Categories that are definitely not placeable and never referenced by a blueprint. */
const EXCLUDED_CATEGORIES = new Set([
  'recipe',
  'technology',
  'explosion',
  'corpse',
  'particle',
  'sticker',
  'smoke',
  'smoke-with-trigger',
  'trivial-smoke',
  'flame-thrower-explosion',
  'fire',
  'stream',
  'projectile',
  'artillery-projectile',
  'beam',
  'sound',
  'tips-and-tricks-item',
  'achievement',
  'tutorial',
  'noise-expression',
  'noise-function',
  'shortcut',
  'custom-input',
  'god-controller',
  'editor-controller',
  'utility-constants',
  'utility-sprites',
  'utility-sounds',
]);

function isRelevantCategory(category: string): boolean {
  if (EXCLUDED_CATEGORIES.has(category)) return false;
  return true;
}

/**
 * Whether an entry from this category should win when two categories define the
 * same name. Items and signals are what icon slots reference, so they take
 * precedence over the entity that happens to share the name.
 */
function categoryRank(category: string): number {
  if (SIGNAL_CATEGORIES.has(category)) return 0;
  return 1;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseShift(v: unknown): [number, number] | undefined {
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const x = asNumber(v[0]);
  const y = asNumber(v[1]);
  return x === undefined || y === undefined ? undefined : [x, y];
}

function parseTint(v: unknown): IconLayer['tint'] | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const t = v as Record<string, unknown>;
  const out: NonNullable<IconLayer['tint']> = {};
  for (const k of ['r', 'g', 'b', 'a'] as const) {
    const n = asNumber(t[k]);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Read a prototype's icon layers. Factorio allows either a single `icon` or an
 * `icons` array of layers (barrels, for instance, are an empty barrel plus a
 * tinted fluid overlay). Both are normalised to a layer list here so callers
 * never branch on which form the prototype used.
 */
function readLayers(proto: Record<string, unknown>): IconLayer[] {
  const single = proto.icon;
  if (typeof single === 'string' && single !== '') {
    const layer: IconLayer = { path: single };
    const size = asNumber(proto.icon_size);
    if (size !== undefined) layer.size = size;
    return [layer];
  }

  const many = proto.icons;
  if (!Array.isArray(many)) return [];

  const layers: IconLayer[] = [];
  for (const raw of many) {
    if (raw === null || typeof raw !== 'object') continue;
    const l = raw as Record<string, unknown>;
    const p = l.icon;
    if (typeof p !== 'string' || p === '') continue;
    const layer: IconLayer = { path: p };
    const size = asNumber(l.icon_size) ?? asNumber(proto.icon_size);
    if (size !== undefined) layer.size = size;
    const scale = asNumber(l.scale);
    if (scale !== undefined) layer.scale = scale;
    const shift = parseShift(l.shift);
    if (shift !== undefined) layer.shift = shift;
    const tint = parseTint(l.tint);
    if (tint !== undefined) layer.tint = tint;
    layers.push(layer);
  }
  return layers;
}

/** Mod name out of a mod-relative path: `__space-age__/graphics/x.png` -> `space-age`. */
export function modOfPath(iconPath: string): string | undefined {
  const m = /^__([^_]+(?:_[^_]+)*)__\//.exec(iconPath);
  return m ? m[1] : undefined;
}

/**
 * Build the slim index from a parsed `data-raw-dump.json`.
 *
 * `version` and `mods` are supplied by the caller (the dump itself does not carry
 * them) and become part of the cache key.
 */
export function buildIconManifest(
  dataRaw: unknown,
  meta: { version: string; mods?: string[] },
): IconManifest {
  if (dataRaw === null || typeof dataRaw !== 'object' || Array.isArray(dataRaw)) {
    throw new ValidationError('data-raw dump was not a JSON object');
  }

  const icons: Record<string, IconEntry> = {};
  const chosenRank: Record<string, number> = {};
  const modsSeen = new Set<string>(meta.mods ?? []);

  for (const [category, group] of Object.entries(dataRaw as Record<string, unknown>)) {
    if (!isRelevantCategory(category)) continue;
    if (group === null || typeof group !== 'object' || Array.isArray(group)) continue;

    for (const [name, proto] of Object.entries(group as Record<string, unknown>)) {
      if (proto === null || typeof proto !== 'object' || Array.isArray(proto)) continue;
      const layers = readLayers(proto as Record<string, unknown>);
      if (layers.length === 0) continue;

      const rank = categoryRank(category);
      // First writer wins within a rank; a better rank always replaces.
      if (icons[name] !== undefined && chosenRank[name] <= rank) continue;

      icons[name] = { category, layers };
      chosenRank[name] = rank;
      for (const l of layers) {
        const mod = modOfPath(l.path);
        if (mod) modsSeen.add(mod);
      }
    }
  }

  return {
    version: meta.version,
    mods: [...modsSeen].sort(),
    generatedAt: new Date().toISOString(),
    icons,
  };
}

/** Every distinct source path a manifest references — what the extractor copies. */
export function referencedPaths(manifest: IconManifest): string[] {
  const set = new Set<string>();
  for (const entry of Object.values(manifest.icons)) {
    for (const layer of entry.layers) set.add(layer.path);
  }
  return [...set].sort();
}

/**
 * Split a mod-relative icon path into its mod and in-mod parts.
 *
 * `__base__/graphics/icons/rail.png` -> `{ mod: 'base', rest: 'graphics/icons/rail.png' }`
 *
 * Returns undefined for anything that is not a mod-relative PNG path or that tries
 * to escape its mod directory — these paths come from a 27 MB JSON blob we did not
 * author, so they are treated as untrusted input.
 */
export function splitIconPath(iconPath: string): { mod: string; rest: string } | undefined {
  const m = /^__([^/]+)__\/(.+)$/.exec(iconPath);
  if (!m) return undefined;
  const mod = m[1];
  const rest = m[2];
  if (mod === '' || mod.includes('..') || mod.includes('/')) return undefined;
  if (rest.includes('..') || rest.startsWith('/')) return undefined;
  if (!/\.png$/i.test(rest)) return undefined;
  return { mod, rest };
}

/**
 * Resolve a mod-relative icon path to a real file inside a Factorio `data` dir.
 * `__base__/graphics/icons/rail.png` -> `<data>/base/graphics/icons/rail.png`
 */
export function resolveIconPath(iconPath: string, dataDir: string): string | undefined {
  const parts = splitIconPath(iconPath);
  return parts ? `${dataDir}/${parts.mod}/${parts.rest}` : undefined;
}

/** Cache directory name for a version + mod set. Vanilla collapses to the version. */
export function cacheKeyFor(version: string, mods: string[] = []): string {
  const extra = mods.filter((m) => !['base', 'core'].includes(m)).sort();
  if (extra.length === 0) return version;
  // Keep it filesystem-safe and bounded; the manifest holds the full list.
  const joined = extra.join(',');
  let h = 0;
  for (let i = 0; i < joined.length; i++) h = (Math.imul(31, h) + joined.charCodeAt(i)) | 0;
  return `${version}-${(h >>> 0).toString(16).padStart(8, '0')}`;
}
