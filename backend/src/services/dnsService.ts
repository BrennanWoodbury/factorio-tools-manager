import type { AppConfig } from '../config.js';
import type { DB } from '../db/index.js';
import { kvGet, kvSet } from '../db/index.js';
import type { DnsRecordRow, ServerRow } from '../db/models.js';
import { CloudflareClient, type SrvData } from '../lib/cloudflare.js';

const KV_HOST_A_RECORD_ID = 'host_a_record_id';
const KV_LAST_PUBLIC_IP = 'last_public_ip';

/**
 * Owns all Cloudflare DNS state for the app:
 *  - one SRV record per server: `_factorio._udp.<subdomain>.<base>` → host:port
 *  - one shared A record `host.<base>` that every SRV target points at, kept in
 *    sync with the current public IP by the DDNS job.
 *
 * When DNS is disabled (no Cloudflare token), every method is a safe no-op so the
 * app runs fine in a local/dev context where players connect by IP:port.
 */
export class DnsService {
  private readonly cf?: CloudflareClient;

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
  ) {
    if (config.dnsEnabled) {
      if (!config.cloudflareZoneId || !config.baseDomain || !config.hostRecordName) {
        throw new Error(
          'DNS is enabled (CLOUDFLARE_API_TOKEN set) but CLOUDFLARE_ZONE_ID, BASE_DOMAIN and HOST_RECORD_NAME are required',
        );
      }
      this.cf = new CloudflareClient(config.cloudflareToken, config.cloudflareZoneId);
    }
  }

  get enabled(): boolean {
    return this.cf !== undefined;
  }

  /** The hostname players connect to for a given server. */
  connectHost(subdomain: string): string | undefined {
    if (!this.config.baseDomain) return undefined;
    return `${subdomain}.${this.config.baseDomain}`;
  }

  private srvData(subdomain: string, port: number): SrvData {
    return {
      service: '_factorio',
      proto: '_udp',
      name: `${subdomain}.${this.config.baseDomain}`,
      priority: 0,
      weight: 0,
      port,
      target: this.config.hostRecordName,
    };
  }

  private fullSrvName(subdomain: string): string {
    return `_factorio._udp.${subdomain}.${this.config.baseDomain}`;
  }

  private srvRowFor(serverId: string): DnsRecordRow | undefined {
    return this.db
      .prepare<DnsRecordRow>(
        "SELECT * FROM dns_records WHERE server_id = ? AND type = 'SRV' ORDER BY id DESC LIMIT 1",
      )
      .get(serverId);
  }

  /** Create the SRV record for a newly-created server. */
  async createServerSrv(server: ServerRow): Promise<void> {
    if (!this.cf) return;
    const record = await this.cf.createSrv(this.srvData(server.subdomain, server.game_port));
    this.db
      .prepare(
        `INSERT INTO dns_records (server_id, type, name, cloudflare_record_id, content)
         VALUES (?, 'SRV', ?, ?, ?)`,
      )
      .run(
        server.id,
        this.fullSrvName(server.subdomain),
        record.id,
        `${this.config.hostRecordName}:${server.game_port}`,
      );
  }

  /**
   * Update a server's SRV record after a subdomain rename and/or port change.
   * If no record is tracked yet (e.g. created while DNS was off) it creates one.
   */
  async updateServerSrv(server: ServerRow): Promise<void> {
    if (!this.cf) return;
    const existing = this.srvRowFor(server.id);
    const data = this.srvData(server.subdomain, server.game_port);
    if (existing?.cloudflare_record_id) {
      await this.cf.updateSrv(existing.cloudflare_record_id, data);
      this.db
        .prepare(
          "UPDATE dns_records SET name = ?, content = ? WHERE id = ?",
        )
        .run(
          this.fullSrvName(server.subdomain),
          `${this.config.hostRecordName}:${server.game_port}`,
          existing.id,
        );
    } else {
      await this.createServerSrv(server);
    }
  }

  /** Remove a server's SRV record from Cloudflare and our bookkeeping. */
  async deleteServerSrv(serverId: string): Promise<void> {
    const rows = this.db
      .prepare<DnsRecordRow>("SELECT * FROM dns_records WHERE server_id = ? AND type = 'SRV'")
      .all(serverId);
    for (const row of rows) {
      if (this.cf && row.cloudflare_record_id) {
        // Best-effort: if the record was already removed at Cloudflare, ignore.
        try {
          await this.cf.deleteRecord(row.cloudflare_record_id);
        } catch (err) {
          console.warn(`[dns] failed to delete SRV ${row.name}: ${(err as Error).message}`);
        }
      }
      this.db.prepare('DELETE FROM dns_records WHERE id = ?').run(row.id);
    }
  }

  /**
   * Ensure the shared host A record matches `ip`. Creates it if missing, updates
   * it if changed, no-ops if already correct. Returns whether a change was made.
   */
  async ensureHostARecord(ip: string): Promise<boolean> {
    if (!this.cf) return false;
    const lastIp = kvGet(this.db, KV_LAST_PUBLIC_IP);
    let recordId = kvGet(this.db, KV_HOST_A_RECORD_ID);

    // Reconcile our cached record id against Cloudflare if we don't have one.
    if (!recordId) {
      const found = await this.cf.findRecords('A', this.config.hostRecordName);
      if (found.length > 0) {
        recordId = found[0].id;
        kvSet(this.db, KV_HOST_A_RECORD_ID, recordId);
        if (found[0].content === ip) {
          kvSet(this.db, KV_LAST_PUBLIC_IP, ip);
          return false;
        }
      }
    } else if (lastIp === ip) {
      return false; // fast path: nothing changed since last check
    }

    if (recordId) {
      await this.cf.updateA(recordId, this.config.hostRecordName, ip);
    } else {
      const created = await this.cf.createA(this.config.hostRecordName, ip);
      kvSet(this.db, KV_HOST_A_RECORD_ID, created.id);
    }
    kvSet(this.db, KV_LAST_PUBLIC_IP, ip);
    return true;
  }
}
