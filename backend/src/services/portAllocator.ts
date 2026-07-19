import type { DB } from '../db/index.js';
import { PortPoolExhaustedError } from '../lib/errors.js';

export type PortKind = 'game' | 'rcon';
export type PortRange = readonly [number, number];

/**
 * Atomic port allocator.
 *
 * Correctness contract (this is the networking-critical invariant of the whole
 * app): a port is considered "in use" iff a row exists for it in
 * `port_allocations`. Because that table's PRIMARY KEY is (kind, port), the DB
 * itself guarantees a given port is claimed at most once. Every claim/release
 * happens inside a single better-sqlite3 transaction (which is synchronous and
 * serialized), so two concurrent server-creates can never be handed the same
 * port — the second matching INSERT would violate the primary key and roll back.
 *
 * Game ports come only from the pre-forwarded UDP range; that host port is what
 * gets advertised in the Factorio SRV record and must equal the externally
 * reachable port (the router forward is manual and 1:1). RCON ports come from a
 * separate range and are never forwarded/advertised.
 */
export class PortAllocator {
  constructor(
    private readonly db: DB,
    private readonly gameRange: PortRange,
    private readonly rconRange: PortRange,
  ) {}

  /** All ports currently claimed for a kind, as a Set for O(1) lookup. */
  private takenSet(kind: PortKind): Set<number> {
    const rows = this.db
      .prepare('SELECT port FROM port_allocations WHERE kind = ?')
      .all(kind) as { port: number }[];
    return new Set(rows.map((r) => r.port));
  }

  private rangeFor(kind: PortKind): PortRange {
    return kind === 'game' ? this.gameRange : this.rconRange;
  }

  /** Lowest free port of `kind`, or throw if the pool is exhausted. Does NOT claim. */
  private nextFree(kind: PortKind): number {
    const [start, end] = this.rangeFor(kind);
    const taken = this.takenSet(kind);
    for (let p = start; p <= end; p++) {
      if (!taken.has(p)) return p;
    }
    throw new PortPoolExhaustedError(kind);
  }

  private claim(kind: PortKind, port: number, serverId: string): void {
    this.db
      .prepare('INSERT INTO port_allocations (kind, port, server_id) VALUES (?, ?, ?)')
      .run(kind, port, serverId);
  }

  /**
   * Atomically allocate one game port and one RCON port for a server. Either both
   * succeed or neither is claimed (the transaction rolls back on any failure,
   * including pool exhaustion of the second range after the first was claimed).
   */
  allocatePair(serverId: string): { gamePort: number; rconPort: number } {
    const txn = this.db.transaction((sid: string) => {
      const gamePort = this.nextFree('game');
      this.claim('game', gamePort, sid);
      const rconPort = this.nextFree('rcon');
      this.claim('rcon', rconPort, sid);
      return { gamePort, rconPort };
    });
    return txn(serverId);
  }

  /** Release every port held by a server (called on delete). Idempotent. */
  releaseServerPorts(serverId: string): void {
    this.db.prepare('DELETE FROM port_allocations WHERE server_id = ?').run(serverId);
  }

  /** Introspection for status / capacity display. */
  capacity(kind: PortKind): { total: number; used: number; free: number } {
    const [start, end] = this.rangeFor(kind);
    const total = end - start + 1;
    const used = this.takenSet(kind).size;
    return { total, used, free: total - used };
  }
}
