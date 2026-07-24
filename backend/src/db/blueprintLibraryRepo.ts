import type { DB, SqlValue } from './index.js';
import {
  decode,
  encode,
  flatten,
  formatGameVersion,
  verifyRoundTrip,
  type BlueprintKind,
  type FlatEntry,
} from '../services/blueprintCodec.js';

export interface BlueprintBlobRow {
  hash: string;
  kind: BlueprintKind;
  label: string | null;
  icons_json: string;
  string: string | null;
  payload_json: string | null;
  entity_counts_json: string | null;
  entity_total: number;
  tile_count: number;
  game_version: string | null;
  byte_size: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface BlueprintSightingRow {
  id: number;
  hash: string;
  server_id: string | null;
  save_name: string;
  location: string;
  path: string;
  collection: string | null;
  source: SightingSource;
  seen_at: string;
}

export type SightingSource = 'scan' | 'upload' | 'paste' | 'backup';

/** Where a blob was observed. One per (blob, place); repeats bump `last_seen_at`. */
export interface SightingInput {
  serverId?: string | null;
  saveName?: string;
  location?: string;
  collection?: string | null;
  source?: SightingSource;
}

/** What an ingest actually changed — drives "12 new, 3 updated" style feedback. */
export interface IngestResult {
  /** Root blob of the ingested string (the book, or the lone blueprint). */
  rootHash: string;
  blobsSeen: number;
  blobsInserted: number;
  sightingsInserted: number;
  /** Entries whose decompose/re-encode round trip failed; their string is kept verbatim. */
  roundTripFailures: string[];
}

/**
 * Data access for the blueprint library.
 *
 * Ingest is content-addressed and idempotent: re-scanning an unchanged save
 * inserts no blobs and no duplicate sightings, it only advances `last_seen_at`.
 * That is what makes a nightly sweep cheap enough to leave on by default.
 */
export class BlueprintLibraryRepo {
  constructor(private readonly db: DB) {}

  // ---- reads ----

  getBlob(hash: string): BlueprintBlobRow | undefined {
    return this.db
      .prepare<BlueprintBlobRow>('SELECT * FROM blueprint_blobs WHERE hash = ?')
      .get(hash);
  }

  /** Ordered child hashes of a book. */
  childHashes(bookHash: string): string[] {
    return this.db
      .prepare<{ child_hash: string }>(
        'SELECT child_hash FROM blueprint_children WHERE book_hash = ? ORDER BY position ASC',
      )
      .all(bookHash)
      .map((r) => r.child_hash);
  }

  sightings(hash: string): BlueprintSightingRow[] {
    return this.db
      .prepare<BlueprintSightingRow>(
        'SELECT * FROM blueprint_sightings WHERE hash = ? ORDER BY seen_at DESC, id DESC',
      )
      .all(hash);
  }

  /**
   * How many *other* places this blob was seen, excluding one server — the count
   * behind "also in N other saves" on a server-scoped card.
   */
  otherSightingCount(hash: string, excludeServerId: string | null): number {
    const row =
      excludeServerId === null
        ? this.db
            .prepare<{ n: number }>(
              'SELECT COUNT(*) AS n FROM blueprint_sightings WHERE hash = ? AND server_id IS NOT NULL',
            )
            .get(hash)
        : this.db
            .prepare<{ n: number }>(
              `SELECT COUNT(*) AS n FROM blueprint_sightings
               WHERE hash = ? AND (server_id IS NULL OR server_id <> ?)`,
            )
            .get(hash, excludeServerId);
    return row?.n ?? 0;
  }

  /** Blobs sighted on a server, newest first. Books and children both appear. */
  listByServer(serverId: string): BlueprintBlobRow[] {
    return this.db
      .prepare<BlueprintBlobRow>(
        `SELECT b.* FROM blueprint_blobs b
         JOIN blueprint_sightings s ON s.hash = b.hash
         WHERE s.server_id = ?
         GROUP BY b.hash
         ORDER BY MAX(s.seen_at) DESC`,
      )
      .all(serverId);
  }

  /** Blobs with no surviving server sighting — the "orphaned" shelf. */
  listOrphaned(): BlueprintBlobRow[] {
    return this.db
      .prepare<BlueprintBlobRow>(
        `SELECT b.* FROM blueprint_blobs b
         WHERE NOT EXISTS (
           SELECT 1 FROM blueprint_sightings s
           WHERE s.hash = b.hash AND s.server_id IS NOT NULL
         )
         ORDER BY b.last_seen_at DESC`,
      )
      .all();
  }

  /** The blueprint string for a blob: stored verbatim if present, else re-encoded. */
  stringFor(hash: string): string | undefined {
    const row = this.getBlob(hash);
    if (!row) return undefined;
    if (row.string) return row.string;
    if (!row.payload_json) return undefined;
    return encode(JSON.parse(row.payload_json) as Record<string, unknown>);
  }

  // ---- writes ----

  /**
   * Decompose a blueprint string into blobs and record a sighting for each.
   *
   * Runs in one transaction so a partially-ingested book can never be observed.
   * Every entry — the book and each descendant — gets its own sighting row, so a
   * blueprint remains findable by its own name even when it only ever lived
   * inside a book.
   */
  ingest(entries: FlatEntry[], where: SightingInput = {}): IngestResult {
    const result: IngestResult = {
      rootHash: entries[entries.length - 1]?.hash ?? '',
      blobsSeen: entries.length,
      blobsInserted: 0,
      sightingsInserted: 0,
      roundTripFailures: [],
    };

    this.db.transaction(() => {
      for (const entry of entries) {
        if (this.upsertBlob(entry, result)) result.blobsInserted++;
        if (this.recordSighting(entry, where)) result.sightingsInserted++;
      }
    })();

    return result;
  }

  /** Convenience: decode + decompose + ingest a raw string. */
  ingestString(input: string, where: SightingInput = {}): IngestResult {
    return this.ingest(flatten(decode(input)), where);
  }

  /** Insert a blob if new; otherwise just advance last_seen_at. Returns true if inserted. */
  private upsertBlob(entry: FlatEntry, result: IngestResult): boolean {
    const existing = this.getBlob(entry.hash);
    if (existing) {
      this.db
        .prepare("UPDATE blueprint_blobs SET last_seen_at = datetime('now') WHERE hash = ?")
        .run(entry.hash);
      return false;
    }

    const isBook = entry.kind === 'blueprint_book';
    const roundTripped = isBook ? true : verifyRoundTrip(entry);
    if (!roundTripped) result.roundTripFailures.push(entry.hash);

    const payloadJson = isBook ? null : JSON.stringify(entry.envelope);
    // Books are manifests, so always keep their string. Otherwise keep the string
    // only when we could NOT prove the payload re-encodes cleanly.
    const stringValue = isBook || !roundTripped ? encode(entry.envelope) : null;
    const counts = entry.entityCounts ?? null;
    const entityTotal = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

    const body = (entry.envelope[entry.kind] ?? {}) as { version?: unknown };

    this.db
      .prepare(
        `INSERT INTO blueprint_blobs
           (hash, kind, label, icons_json, string, payload_json, entity_counts_json,
            entity_total, tile_count, game_version, byte_size)
         VALUES
           (@hash, @kind, @label, @icons_json, @string, @payload_json, @entity_counts_json,
            @entity_total, @tile_count, @game_version, @byte_size)`,
      )
      .run({
        hash: entry.hash,
        kind: entry.kind,
        label: entry.label ?? null,
        icons_json: JSON.stringify(entry.icons ?? []),
        string: stringValue,
        payload_json: payloadJson,
        entity_counts_json: counts ? JSON.stringify(counts) : null,
        entity_total: entityTotal,
        tile_count: entry.tileCount ?? 0,
        game_version: formatGameVersion(body.version) ?? null,
        byte_size: payloadJson ? Buffer.byteLength(payloadJson) : (stringValue?.length ?? 0),
      } as unknown as Record<string, SqlValue>);

    if (entry.children) {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO blueprint_children (book_hash, position, child_hash) VALUES (?, ?, ?)',
      );
      entry.children.forEach((childHash, i) => stmt.run(entry.hash, i, childHash));
    }

    return true;
  }

  /**
   * Record where a blob was seen, deduped on (hash, server, save, path) so a
   * repeat scan of an unchanged save does not pile up identical rows.
   */
  private recordSighting(entry: FlatEntry, where: SightingInput): boolean {
    const serverId = where.serverId ?? null;
    const saveName = where.saveName ?? '';
    const path = entry.path;

    const existing =
      serverId === null
        ? this.db
            .prepare<{ id: number }>(
              `SELECT id FROM blueprint_sightings
               WHERE hash = ? AND server_id IS NULL AND save_name = ? AND path = ?`,
            )
            .get(entry.hash, saveName, path)
        : this.db
            .prepare<{ id: number }>(
              `SELECT id FROM blueprint_sightings
               WHERE hash = ? AND server_id = ? AND save_name = ? AND path = ?`,
            )
            .get(entry.hash, serverId, saveName, path);

    if (existing) {
      this.db
        .prepare("UPDATE blueprint_sightings SET seen_at = datetime('now') WHERE id = ?")
        .run(existing.id);
      return false;
    }

    this.db
      .prepare(
        `INSERT INTO blueprint_sightings
           (hash, server_id, save_name, location, path, collection, source)
         VALUES (@hash, @server_id, @save_name, @location, @path, @collection, @source)`,
      )
      .run({
        hash: entry.hash,
        server_id: serverId,
        save_name: saveName,
        location: where.location ?? '',
        path,
        collection: where.collection ?? null,
        source: where.source ?? 'scan',
      } as unknown as Record<string, SqlValue>);

    return true;
  }
}
