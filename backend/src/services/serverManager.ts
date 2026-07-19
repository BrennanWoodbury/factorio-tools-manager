import { randomUUID, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { DB } from '../db/index.js';
import type { ServerRow } from '../db/models.js';
import { ServersRepo } from '../db/serversRepo.js';
import { PortAllocator } from './portAllocator.js';
import { DockerService } from './dockerService.js';
import { DnsService } from './dnsService.js';
import { RconService } from './rconService.js';
import { serverFiles, type ModEntry } from './serverFiles.js';
import { DuplicateSubdomainError, NotFoundError, ValidationError } from '../lib/errors.js';

export interface CreateServerInput {
  name: string;
  subdomain: string;
  maxPlayers?: number;
  description?: string;
  saveName?: string;
  generateNewSave?: boolean;
  modPortalUsername?: string;
  modPortalToken?: string;
  mods?: ModEntry[];
}

export interface UpdateServerInput {
  name?: string;
  subdomain?: string;
  maxPlayers?: number;
  description?: string;
  saveName?: string;
  generateNewSave?: boolean;
  modPortalUsername?: string;
  modPortalToken?: string;
}

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Orchestrates a server's whole lifecycle across the allocator, Docker, DNS and
 * the filesystem. Creation is transactional in the DB (row + port claim) and
 * best-effort/rolled-back for the external side effects (DNS record).
 */
export class ServerManager {
  constructor(
    private readonly db: DB,
    private readonly repo: ServersRepo,
    private readonly allocator: PortAllocator,
    private readonly docker: DockerService,
    private readonly dns: DnsService,
    private readonly rcon: RconService,
    private readonly config: AppConfig,
  ) {}

  private validateSubdomain(subdomain: string): void {
    if (!SUBDOMAIN_RE.test(subdomain)) {
      throw new ValidationError(
        'Subdomain must be a valid DNS label: lowercase letters, digits and hyphens',
      );
    }
  }

  list(): ServerRow[] {
    return this.repo.list();
  }

  get(id: string): ServerRow {
    const row = this.repo.getById(id);
    if (!row) throw new NotFoundError('Server');
    return row;
  }

  connectHost(row: ServerRow): string | undefined {
    return this.dns.connectHost(row.subdomain);
  }

  async create(input: CreateServerInput): Promise<ServerRow> {
    this.validateSubdomain(input.subdomain);
    if (this.repo.getBySubdomain(input.subdomain)) {
      throw new DuplicateSubdomainError(input.subdomain);
    }

    const id = randomUUID().slice(0, 8);
    const rconPassword = randomBytes(18).toString('base64url');
    const saveName = input.saveName?.trim() || 'default';

    const baseRow: ServerRow = {
      id,
      name: input.name.trim(),
      subdomain: input.subdomain,
      description: input.description?.trim() ?? '',
      max_players: input.maxPlayers ?? 0,
      game_port: 0,
      rcon_port: 0,
      rcon_password: rconPassword,
      save_name: saveName,
      generate_new_save: input.generateNewSave === false ? 0 : 1,
      mod_portal_username: input.modPortalUsername ?? '',
      mod_portal_token: input.modPortalToken ?? '',
      container_id: null,
      status: 'stopped',
      created_at: '',
      updated_at: '',
    };

    // Phase 1: atomic DB write — insert row and claim ports together, so a port
    // is never claimed without a server, nor a server left without ports.
    const persist = this.db.transaction((): ServerRow => {
      this.repo.insert(baseRow);
      const { gamePort, rconPort } = this.allocator.allocatePair(id);
      this.db
        .prepare('UPDATE servers SET game_port = ?, rcon_port = ? WHERE id = ?')
        .run(gamePort, rconPort, id);
      return this.repo.getById(id)!;
    });
    const row = persist();

    // Phase 2: filesystem (idempotent, safe to leave behind if later steps fail).
    try {
      serverFiles.ensureDirs(id);
      serverFiles.writeServerSettings(row);
      if (input.mods && input.mods.length > 0) {
        serverFiles.writeModList(id, input.mods);
      }
    } catch (err) {
      this.hardDelete(id);
      throw err;
    }

    // Phase 3: DNS side effect. If Cloudflare fails, roll the whole thing back so
    // we don't leave an unreachable server with claimed ports.
    try {
      await this.dns.createServerSrv(row);
    } catch (err) {
      this.hardDelete(id);
      throw err;
    }

    return row;
  }

  async update(id: string, input: UpdateServerInput): Promise<ServerRow> {
    const current = this.get(id);
    const fields: Record<string, string | number> = {};
    if (input.name !== undefined) fields.name = input.name.trim();
    if (input.description !== undefined) fields.description = input.description.trim();
    if (input.maxPlayers !== undefined) fields.max_players = input.maxPlayers;
    if (input.saveName !== undefined) fields.save_name = input.saveName.trim() || 'default';
    if (input.generateNewSave !== undefined) fields.generate_new_save = input.generateNewSave ? 1 : 0;
    if (input.modPortalUsername !== undefined) fields.mod_portal_username = input.modPortalUsername;
    if (input.modPortalToken !== undefined) fields.mod_portal_token = input.modPortalToken;

    let subdomainChanged = false;
    if (input.subdomain !== undefined && input.subdomain !== current.subdomain) {
      this.validateSubdomain(input.subdomain);
      if (this.repo.getBySubdomain(input.subdomain)) {
        throw new DuplicateSubdomainError(input.subdomain);
      }
      fields.subdomain = input.subdomain;
      subdomainChanged = true;
    }

    this.repo.update(id, fields as never);
    const updated = this.get(id);

    // A subdomain change must update the SRV record name.
    if (subdomainChanged) {
      await this.dns.updateServerSrv(updated);
    }
    return updated;
  }

  async start(id: string): Promise<void> {
    const row = this.get(id);
    await this.docker.ensureNetwork();
    // Recreate the container each start so it always reflects current config
    // (env vars, ports). Data lives in the bind mount, so this is cheap.
    serverFiles.writeServerSettings(row);
    await this.docker.remove(id);
    const containerId = await this.docker.createContainer(row, serverFiles.hostDir(id));
    await this.docker.start(id);
    this.repo.setStatus(id, 'running', containerId);
  }

  async stop(id: string): Promise<void> {
    this.get(id);
    await this.rcon.disconnect(id);
    await this.docker.stop(id);
    this.repo.setStatus(id, 'stopped');
  }

  async restart(id: string): Promise<void> {
    // Full recreate to pick up any config changes.
    await this.start(id);
  }

  async delete(id: string): Promise<void> {
    const row = this.get(id);
    await this.rcon.disconnect(id);
    // Remove the container (best-effort; ignore if already gone).
    try {
      await this.docker.remove(id);
    } catch (err) {
      console.warn(`[manager] container remove during delete failed: ${(err as Error).message}`);
    }
    // Remove DNS records (best-effort).
    try {
      await this.dns.deleteServerSrv(id);
    } catch (err) {
      console.warn(`[manager] SRV delete during delete failed: ${(err as Error).message}`);
    }
    this.hardDelete(id);
    void row;
  }

  /** DB + filesystem teardown. Ports/dns rows cascade from the servers delete. */
  private hardDelete(id: string): void {
    this.db.transaction(() => {
      this.allocator.releaseServerPorts(id);
      this.repo.delete(id);
    })();
    serverFiles.removeAll(id);
  }

  /** Live status: container state + player count (RCON) when running. */
  async status(id: string): Promise<{
    id: string;
    status: string;
    running: boolean;
    startedAt?: string;
    players?: { count: number; names: string[] };
    playersError?: string;
  }> {
    const row = this.get(id);
    const cs = await this.docker.status(id);
    const status = cs.running ? 'running' : cs.exists ? 'stopped' : 'stopped';
    if (this.repo.getById(id)!.status !== status) this.repo.setStatus(id, status);

    const result = {
      id,
      status,
      running: cs.running,
      startedAt: cs.startedAt,
    } as Awaited<ReturnType<ServerManager['status']>>;

    if (cs.running) {
      try {
        result.players = await this.rcon.players(row);
      } catch (err) {
        result.playersError = (err as Error).message;
      }
    }
    return result;
  }
}
