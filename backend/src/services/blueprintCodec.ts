import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { ValidationError } from '../lib/errors.js';

/**
 * Blueprint-string codec: decode / encode / hash Factorio blueprint strings.
 *
 * A blueprint string is a version byte ('0'), then base64 of zlib-deflated JSON.
 * The format is stable and public, so the entire library — search, rendering,
 * diffing, re-export — runs here in pure TypeScript. Factorio is only ever needed
 * to *extract* strings out of a save, never to display or manipulate one.
 *
 * The unit of storage is the "blob": a single blueprint / deconstruction-planner /
 * upgrade-planner. Books are decomposed into their children (see `flatten`) so a
 * book is stored as a manifest of child hashes rather than one opaque payload —
 * editing one blueprint in a 200-entry book then costs one small blob instead of a
 * whole new copy of the book. This is what makes full version history cheap.
 */

/** The four planner-ish item kinds a blueprint string can carry. */
export type BlueprintKind = 'blueprint' | 'blueprint_book' | 'deconstruction_planner' | 'upgrade_planner';

const KINDS: BlueprintKind[] = [
  'blueprint',
  'blueprint_book',
  'deconstruction_planner',
  'upgrade_planner',
];

/** A blueprint icon: a signal reference plus its 1-based slot. */
export interface BlueprintIcon {
  index?: number;
  signal?: { type?: string; name?: string };
}

/** The decoded payload, still wrapped in its single top-level kind key. */
export type BlueprintEnvelope = Record<string, unknown>;

/**
 * One decomposed entry. `hash` identifies the *content*; `path` identifies the
 * *slot* it was found in (e.g. `book:Rail Standards/3`) and is what a version
 * lineage is keyed on — same path with changed content means an edit.
 */
export interface FlatEntry {
  hash: string;
  kind: BlueprintKind;
  path: string;
  label?: string;
  icons: BlueprintIcon[];
  /** Child hashes in book order. Only set when `kind === 'blueprint_book'`. */
  children?: string[];
  /** Entity name -> count. Only set for `kind === 'blueprint'`. */
  entityCounts?: Record<string, number>;
  tileCount?: number;
  /** The canonical single-entry envelope, ready to re-encode on its own. */
  envelope: BlueprintEnvelope;
}

/** Factorio packs its version into a u64 as four LE u16s: major.minor.patch.dev. */
export function formatGameVersion(version: unknown): string | undefined {
  if (typeof version !== 'number' && typeof version !== 'bigint') return undefined;
  const v = BigInt(version);
  if (v < 0n) return undefined;
  return [3, 2, 1, 0].map((i) => Number((v >> BigInt(i * 16)) & 0xffffn)).join('.');
}

/**
 * Recursively sort object keys so semantically identical payloads serialise
 * identically. Hashing this — rather than the raw base64 — makes identity robust
 * to zlib settings and key ordering, which are not guaranteed stable across
 * Factorio versions or re-exports. Without it, a re-compression would look like an
 * edit and pollute every version history.
 */
export function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out as unknown as T;
  }
  return value;
}

/** Content address of a decoded payload: sha256 over its canonical JSON. */
export function hashPayload(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

/** Cheap shape check — lets callers filter candidate strings before decoding. */
export function looksLikeBlueprintString(s: string): boolean {
  return /^0[A-Za-z0-9+/=\s]+$/.test(s.trim());
}

/**
 * Decode a blueprint string into its JSON envelope. Throws ValidationError (not a
 * generic Error) on anything malformed so routes surface a 400 rather than a 500 —
 * these strings are pasted by hand and being wrong is an expected outcome.
 */
export function decode(input: string): BlueprintEnvelope {
  const s = input.trim().replace(/\s+/g, '');
  if (s.length === 0) throw new ValidationError('Blueprint string is empty');
  if (s[0] !== '0') {
    throw new ValidationError(`Unsupported blueprint string version byte '${s[0]}' (expected '0')`);
  }

  let raw: Buffer;
  try {
    raw = Buffer.from(s.slice(1), 'base64');
  } catch {
    throw new ValidationError('Blueprint string is not valid base64');
  }
  if (raw.length === 0) throw new ValidationError('Blueprint string decoded to no data');

  let json: string;
  try {
    json = zlib.inflateSync(raw).toString('utf8');
  } catch {
    throw new ValidationError('Blueprint string is not valid zlib data (truncated or corrupt?)');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError('Blueprint string did not contain valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Blueprint payload was not a JSON object');
  }

  const env = parsed as BlueprintEnvelope;
  if (!kindOf(env)) {
    throw new ValidationError(
      `Blueprint payload has no recognised top-level key (expected one of: ${KINDS.join(', ')})`,
    );
  }
  return env;
}

/** Encode an envelope back into a blueprint string. */
export function encode(envelope: BlueprintEnvelope): string {
  const json = JSON.stringify(envelope);
  return '0' + zlib.deflateSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64');
}

/** The envelope's single top-level kind key, if it is one we understand. */
export function kindOf(envelope: BlueprintEnvelope): BlueprintKind | undefined {
  return KINDS.find((k) => envelope[k] !== undefined && envelope[k] !== null);
}

/** The inner body of an envelope (the value under its kind key). */
function bodyOf(envelope: BlueprintEnvelope): Record<string, unknown> {
  const kind = kindOf(envelope);
  const body = kind ? envelope[kind] : undefined;
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/** Entity-name -> count for a blueprint body. The basis of similarity scoring. */
function countEntities(body: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  const entities = body.entities;
  if (!Array.isArray(entities)) return counts;
  for (const e of entities) {
    const name = e !== null && typeof e === 'object' ? (e as { name?: unknown }).name : undefined;
    if (typeof name === 'string') counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function iconsOf(body: Record<string, unknown>): BlueprintIcon[] {
  return Array.isArray(body.icons) ? (body.icons as BlueprintIcon[]) : [];
}

function labelOf(body: Record<string, unknown>): string | undefined {
  return typeof body.label === 'string' && body.label !== '' ? body.label : undefined;
}

/** A path-safe form of a label, so slot paths stay readable and stable. */
function pathSegment(label: string | undefined, index: number): string {
  const base = label ? label.replace(/[/\\]/g, '_').trim() : '';
  return base === '' ? String(index) : `${index}:${base}`;
}

/**
 * Decompose an envelope into a flat list of content-addressed entries — the
 * blob/tree split. Books yield one entry for the book (carrying its ordered child
 * hashes) plus one entry per descendant; a bare blueprint yields a single entry.
 *
 * Entries come back deepest-first so children are always present before the parent
 * that references them, letting a caller insert blobs in one pass without
 * deferring foreign keys.
 */
export function flatten(envelope: BlueprintEnvelope, basePath = ''): FlatEntry[] {
  const kind = kindOf(envelope);
  if (!kind) throw new ValidationError('Cannot flatten an unrecognised blueprint payload');
  const body = bodyOf(envelope);
  const label = labelOf(body);
  const icons = iconsOf(body);
  const path = basePath === '' ? (label ? `${kind}:${label}` : kind) : basePath;

  if (kind !== 'blueprint_book') {
    const entry: FlatEntry = {
      hash: hashPayload(envelope),
      kind,
      path,
      label,
      icons,
      envelope,
    };
    if (kind === 'blueprint') {
      entry.entityCounts = countEntities(body);
      entry.tileCount = Array.isArray(body.tiles) ? body.tiles.length : 0;
    }
    return [entry];
  }

  const rawChildren = Array.isArray(body.blueprints) ? body.blueprints : [];
  const descendants: FlatEntry[] = [];
  const childHashes: string[] = [];

  rawChildren.forEach((child, i) => {
    if (child === null || typeof child !== 'object') return;
    const childEnv = { ...(child as Record<string, unknown>) };
    // `index` is the child's slot within the book, not part of its content — strip
    // it so the same blueprint in two different slots is one blob, not two.
    delete childEnv.index;
    if (!kindOf(childEnv)) return;
    const childLabel = labelOf(bodyOf(childEnv));
    const sub = flatten(childEnv, `${path}/${pathSegment(childLabel, i)}`);
    descendants.push(...sub);
    // The last entry of a recursive call is that subtree's own root.
    const root = sub[sub.length - 1];
    if (root) childHashes.push(root.hash);
  });

  // The book's identity is its ordered children plus its own presentation, NOT the
  // full nested payload — so re-nesting an unchanged child never re-hashes the book.
  const bookIdentity = { kind, label, icons: canonicalize(icons), children: childHashes };

  return [
    ...descendants,
    {
      hash: hashPayload(bookIdentity),
      kind,
      path,
      label,
      icons,
      children: childHashes,
      envelope,
    },
  ];
}

/** Decode and decompose in one step. */
export function decodeAndFlatten(input: string): FlatEntry[] {
  return flatten(decode(input));
}

/**
 * Verify a single entry survives a decompose -> re-encode -> re-decode round trip
 * with its canonical hash intact. Run on ingest: if this ever fails we must keep
 * the original string for that item rather than trusting the decomposed form.
 */
export function verifyRoundTrip(entry: FlatEntry): boolean {
  if (entry.kind === 'blueprint_book') return true; // books are manifests, not payloads
  try {
    return hashPayload(decode(encode(entry.envelope))) === entry.hash;
  } catch {
    return false;
  }
}
