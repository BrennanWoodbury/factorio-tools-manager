import { randomUUID, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { kvGet, kvSet, type DB } from '../db/index.js';
import type { ServerRow } from '../db/models.js';
import { ServersRepo } from '../db/serversRepo.js';
import { PortAllocator } from './portAllocator.js';
import { DockerService } from './dockerService.js';
import { DnsService } from './dnsService.js';
import { RconService } from './rconService.js';
import { serverFiles, sanitizeName, type ModEntry } from './serverFiles.js';
import { getFactorioAccount } from './factorioAccount.js';
import { DockerError, DuplicateSubdomainError, NotFoundError, ValidationError } from '../lib/errors.js';

export interface CreateServerInput {
  name: string;
  subdomain: string;
  maxPlayers?: number;
  description?: string;
  saveName?: string;
  generateNewSave?: boolean;
  factorioTag?: string;
  autoRestart?: boolean;
  mods?: ModEntry[];
  /** Initial map-gen-settings for the server's first generated map (optional). */
  mapGen?: Record<string, unknown>;
}

export interface UpdateServerInput {
  name?: string;
  subdomain?: string;
  maxPlayers?: number;
  description?: string;
  saveName?: string;
  generateNewSave?: boolean;
  factorioTag?: string;
  autoRestart?: boolean;
  autoBackup?: boolean;
  backupIntervalMinutes?: number;
  backupKeep?: number;
}

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// Valid Docker image tag (also allow empty to mean "use the global default").
const TAG_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/;

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

  /** Validate an image tag; returns the trimmed tag ('' means default). */
  private cleanTag(tag: string | undefined): string {
    const t = (tag ?? '').trim();
    if (t !== '' && !TAG_RE.test(t)) {
      throw new ValidationError('Factorio tag must be a valid Docker image tag (e.g. stable, 2.0.55)');
    }
    return t;
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
      // Credentials are global now (see factorioAccount); these columns are unused.
      factorio_username: '',
      factorio_token: '',
      container_id: null,
      status: 'stopped',
      created_at: '',
      updated_at: '',
      settings_json: null,
      applied_modpack_id: null,
      whitelist_json: null,
      factorio_tag: this.cleanTag(input.factorioTag),
      auto_restart: input.autoRestart ? 1 : 0,
      adminlist_json: null,
      desired_state: 'stopped',
      auto_backup: 0,
      backup_interval_minutes: 60,
      backup_keep: 10,
      map_gen_settings_json:
        input.mapGen && Object.keys(input.mapGen).length > 0 ? JSON.stringify(input.mapGen) : null,
      map_settings_json: null,
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
    // Track whether anything that only takes effect at (re)start actually changed,
    // so auto-restart fires only on a real change (not e.g. toggling auto_restart
    // itself, or a no-op save).
    let restartRelevantChanged = false;
    const set = (key: string, value: string | number, restartRelevant: boolean) => {
      fields[key] = value;
      if (restartRelevant) restartRelevantChanged = true;
    };

    if (input.name !== undefined && input.name.trim() !== current.name) set('name', input.name.trim(), true);
    if (input.description !== undefined && input.description.trim() !== current.description)
      set('description', input.description.trim(), true);
    if (input.maxPlayers !== undefined && input.maxPlayers !== current.max_players)
      set('max_players', input.maxPlayers, true);
    if (input.saveName !== undefined) {
      const save = input.saveName.trim() || 'default';
      if (save !== current.save_name) set('save_name', save, true);
    }
    if (input.generateNewSave !== undefined) {
      const gen = input.generateNewSave ? 1 : 0;
      if (gen !== current.generate_new_save) set('generate_new_save', gen, true);
    }
    if (input.factorioTag !== undefined) {
      const tag = this.cleanTag(input.factorioTag);
      if (tag !== (current.factorio_tag ?? '')) set('factorio_tag', tag, true);
    }
    if (input.autoRestart !== undefined) {
      const ar = input.autoRestart ? 1 : 0;
      if (ar !== current.auto_restart) set('auto_restart', ar, false); // toggling it isn't restart-worthy
    }
    // Backup config — never requires a game restart.
    if (input.autoBackup !== undefined) {
      const ab = input.autoBackup ? 1 : 0;
      if (ab !== current.auto_backup) set('auto_backup', ab, false);
    }
    if (input.backupIntervalMinutes !== undefined && input.backupIntervalMinutes !== current.backup_interval_minutes)
      set('backup_interval_minutes', Math.max(5, Math.floor(input.backupIntervalMinutes)), false);
    if (input.backupKeep !== undefined && input.backupKeep !== current.backup_keep)
      set('backup_keep', Math.max(1, Math.floor(input.backupKeep)), false);

    let subdomainChanged = false;
    if (input.subdomain !== undefined && input.subdomain !== current.subdomain) {
      this.validateSubdomain(input.subdomain);
      if (this.repo.getBySubdomain(input.subdomain)) {
        throw new DuplicateSubdomainError(input.subdomain);
      }
      fields.subdomain = input.subdomain; // SRV record only — no game restart needed
      subdomainChanged = true;
    }

    this.repo.update(id, fields as never);
    const updated = this.get(id);

    // A subdomain change must update the SRV record name (live, no restart).
    if (subdomainChanged) {
      await this.dns.updateServerSrv(updated);
    }
    await this.maybeAutoRestart(id, restartRelevantChanged);
    return updated;
  }

  /**
   * If a restart-requiring change was made, the server has auto-restart enabled,
   * and it's currently running, kick off a restart in the background to apply it.
   * Returns whether a restart was triggered.
   */
  async maybeAutoRestart(id: string, requiresRestart: boolean): Promise<boolean> {
    if (!requiresRestart) return false;
    const row = this.get(id);
    if (row.auto_restart !== 1) return false;
    // Don't let a Docker hiccup fail the settings save — just skip the restart.
    let running = false;
    try {
      running = (await this.docker.status(id)).running;
    } catch (err) {
      console.warn(`[manager] auto-restart status check failed for ${id}: ${(err as Error).message}`);
      return false;
    }
    if (!running) return false;
    console.log(`[manager] auto-restarting ${id} to apply config change`);
    // Fire-and-forget: don't make the settings request wait for the restart. The
    // UI reflects it via status polling.
    void this.restart(id).catch((err) =>
      console.error(`[manager] auto-restart of ${id} failed: ${(err as Error).message}`),
    );
    return true;
  }

  /** The effective advanced server-settings (defaults filled, managed keys stripped). */
  getSettings(id: string): Record<string, unknown> {
    return serverFiles.getAdvancedSettings(this.get(id));
  }

  /**
   * Replace a server's advanced server-settings. Managed keys (name/description/
   * max_players) are stripped — those are edited via the basic form/update() — so
   * there's no drift between the two. Applies to the game on next start.
   */
  async updateSettings(id: string, advanced: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.get(id); // 404 if unknown
    const clean = { ...advanced };
    for (const k of ['name', 'description', 'max_players']) delete clean[k];
    this.repo.setSettingsJson(id, JSON.stringify(clean));
    await this.maybeAutoRestart(id, true);
    return serverFiles.getAdvancedSettings(this.get(id));
  }

  // ---- Map generation (new-save settings) ----

  /** Effective map-gen-settings for a server (defaults filled). */
  getMapGen(id: string): { mapGen: Record<string, unknown> } {
    return { mapGen: serverFiles.getMapGenSettings(this.get(id)) };
  }

  /**
   * Store new-map generation settings (map-gen-settings.json only — resources,
   * water, terrain, cliffs, starting area, peaceful mode, seed). These only affect
   * the NEXT map generated (a fresh start with no save, or an explicit "New save"),
   * so no running game is restarted. (map-settings.json — pollution/evolution/
   * expansion — is left to the image, which ships a version-matched file; Factorio
   * rejects a hand-written one that doesn't match the exact binary version.)
   */
  async updateMapGen(
    id: string,
    input: { mapGen: Record<string, unknown> },
  ): Promise<{ mapGen: Record<string, unknown> }> {
    this.get(id); // 404 if unknown
    this.repo.setMapGenSettingsJson(id, JSON.stringify(input.mapGen));
    return this.getMapGen(id);
  }

  // ---- Whitelist ----

  /** Sanitise a list of usernames: trim, drop blanks, dedupe (case-insensitive). */
  private sanitizeNames(names: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of names) {
      const name = String(raw).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  getServerWhitelist(id: string): string[] {
    const row = this.get(id);
    if (!row.whitelist_json) return [];
    try {
      return JSON.parse(row.whitelist_json) as string[];
    } catch {
      return [];
    }
  }

  async setServerWhitelist(id: string, names: string[]): Promise<string[]> {
    this.get(id); // 404 if unknown
    const clean = this.sanitizeNames(names);
    this.repo.setWhitelistJson(id, JSON.stringify(clean));
    await this.maybeAutoRestart(id, true);
    return clean;
  }

  getGlobalWhitelist(): string[] {
    const raw = kvGet(this.db, 'global_whitelist');
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  async setGlobalWhitelist(names: string[]): Promise<string[]> {
    const clean = this.sanitizeNames(names);
    kvSet(this.db, 'global_whitelist', JSON.stringify(clean));
    // The global whitelist affects every server — auto-restart any running ones
    // that opted in.
    for (const s of this.repo.list()) {
      await this.maybeAutoRestart(s.id, true);
    }
    return clean;
  }

  /** Effective whitelist for a server = global ∪ per-server (deduped). */
  effectiveWhitelist(id: string): string[] {
    return this.sanitizeNames([...this.getGlobalWhitelist(), ...this.getServerWhitelist(id)]);
  }

  // ---- Admin list (same shape as the whitelist) ----

  getServerAdminlist(id: string): string[] {
    const row = this.get(id);
    if (!row.adminlist_json) return [];
    try {
      return JSON.parse(row.adminlist_json) as string[];
    } catch {
      return [];
    }
  }

  async setServerAdminlist(id: string, names: string[]): Promise<string[]> {
    this.get(id);
    const clean = this.sanitizeNames(names);
    this.repo.setAdminlistJson(id, JSON.stringify(clean));
    await this.maybeAutoRestart(id, true);
    return clean;
  }

  getGlobalAdminlist(): string[] {
    const raw = kvGet(this.db, 'global_adminlist');
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  async setGlobalAdminlist(names: string[]): Promise<string[]> {
    const clean = this.sanitizeNames(names);
    kvSet(this.db, 'global_adminlist', JSON.stringify(clean));
    for (const s of this.repo.list()) {
      await this.maybeAutoRestart(s.id, true);
    }
    return clean;
  }

  /** Effective admin list for a server = global ∪ per-server (deduped). */
  effectiveAdminlist(id: string): string[] {
    return this.sanitizeNames([...this.getGlobalAdminlist(), ...this.getServerAdminlist(id)]);
  }

  async start(id: string): Promise<void> {
    const row = this.get(id);
    await this.docker.ensureNetwork();
    // Recreate the container each start so it always reflects current config
    // (env vars, ports). Data lives in the bind mount, so this is cheap.
    serverFiles.writeServerSettings(row);
    // Custom map-gen settings (if any) written to config/ so the image's `--create`
    // (GENERATE_NEW_SAVE=true, or first start with no saves) honours them; also heals
    // any stale incomplete map-settings.json left by an earlier build.
    serverFiles.writeMapGenSettings(row);
    // The image reads its RCON password from config/rconpw (ignoring the env var),
    // so write our stored password there so the manager can authenticate.
    serverFiles.writeRconPassword(id, row.rcon_password);
    // Effective whitelist / admin list = global ∪ per-server. Written each start.
    serverFiles.writeWhitelist(id, this.effectiveWhitelist(id));
    serverFiles.writeAdminlist(id, this.effectiveAdminlist(id));
    await this.docker.remove(id);
    const containerId = await this.docker.createContainer(
      row,
      serverFiles.hostDir(id),
      getFactorioAccount(this.db),
    );
    await this.docker.start(id);
    this.repo.setStatus(id, 'running', containerId);
    // Record intent so the server is resumed if the manager restarts.
    this.repo.setDesiredState(id, 'running');
  }

  /**
   * Create a new named save offline (server must be stopped). Runs the Factorio
   * binary once in a throwaway container with `--create`. Throws with the job's
   * log tail if generation fails.
   */
  async createSave(id: string, saveName: string): Promise<{ name: string }> {
    const row = this.get(id);
    const name = sanitizeName(saveName);
    const cs = await this.docker.status(id);
    if (cs.running) {
      throw new ValidationError('Stop the server before creating a save');
    }
    if (serverFiles.saveExists(id, name)) {
      throw new ValidationError(`A save named "${name}" already exists`);
    }
    serverFiles.ensureDirs(id);
    // The one-shot overrides the entrypoint and invokes the binary directly, so the
    // image's own map-gen handling (incl. copying example configs) doesn't run. Write
    // our custom map-gen file (if the server has one) and pass it explicitly. We don't
    // pass --map-settings: omitting it uses Factorio's built-in, version-correct
    // defaults (a hand-written file risks the strict-schema crash).
    serverFiles.writeMapGenSettings(row);
    const args = ['--create', `/factorio/saves/${name}.zip`];
    if (row.map_gen_settings_json) {
      args.push('--map-gen-settings', '/factorio/config/map-gen-settings.json');
    }
    const { exitCode, logs } = await this.docker.runOneShot(row, serverFiles.hostDir(id), args);
    if (exitCode !== 0 || !serverFiles.saveExists(id, name)) {
      throw new DockerError(`save generation failed (exit ${exitCode}): ${logs.slice(-500)}`);
    }
    return { name };
  }

  /**
   * Restore the server onto a given save: select it (don't generate a new one) and
   * (re)start so it loads immediately. Starts the server if it was stopped, restarts
   * it if running. Discards any unsaved progress in the current game.
   */
  async restoreFromSave(id: string, saveName: string): Promise<ServerRow> {
    this.get(id);
    const name = sanitizeName(saveName);
    if (!serverFiles.saveExists(id, name)) throw new ValidationError(`No such save "${name}"`);
    await this.update(id, { saveName: name, generateNewSave: false });
    // start() recreates the container from scratch, so it loads the selected save
    // whether the server was previously running or stopped.
    await this.start(id);
    return this.get(id);
  }

  // ---- Backups ----

  /**
   * Create a backup of a save. If the server is running, first force a fresh save
   * over RCON (best-effort) so the backup captures current state. Backs up the
   * given save, or the newest one. Prunes to the server's keep count.
   */
  async backupNow(id: string, saveName?: string): Promise<{ name: string; source: string }> {
    const row = this.get(id);
    let cs;
    try {
      cs = await this.docker.status(id);
    } catch {
      cs = { running: false } as { running: boolean };
    }
    if (cs.running) {
      try {
        await this.rcon.send(row, '/server-save');
        await new Promise((r) => setTimeout(r, 2500)); // let the save flush to disk
      } catch (err) {
        console.warn(`[backup] /server-save on ${id} failed: ${(err as Error).message}`);
      }
    }
    const source = saveName ?? serverFiles.latestSaveName(id);
    if (!source) throw new ValidationError('No save available to back up');
    const name = serverFiles.backupSave(id, source);
    serverFiles.pruneBackups(id, row.backup_keep);
    kvSet(this.db, `backup_last_${id}`, String(Date.now()));
    return { name, source };
  }

  listBackups(id: string) {
    this.get(id);
    return serverFiles.listBackups(id);
  }

  deleteBackup(id: string, name: string): void {
    this.get(id);
    serverFiles.deleteBackup(id, name);
  }

  /** Restore a backup into saves/ and select it. Server must be stopped. */
  async restoreBackup(id: string, name: string): Promise<string> {
    this.get(id);
    if ((await this.docker.status(id).catch(() => ({ running: false }))).running) {
      throw new ValidationError('Stop the server before restoring a backup');
    }
    const source = serverFiles.restoreBackup(id, name);
    await this.update(id, { saveName: source, generateNewSave: false });
    return source;
  }

  /** Run scheduled backups for any auto-backup server whose interval has elapsed. */
  async runDueBackups(): Promise<void> {
    const now = Date.now();
    for (const row of this.repo.list()) {
      if (row.auto_backup !== 1) continue;
      const last = Number(kvGet(this.db, `backup_last_${row.id}`) ?? 0);
      if (now - last < row.backup_interval_minutes * 60_000) continue;
      try {
        const { name } = await this.backupNow(row.id);
        console.log(`[backup] auto-backed up ${row.subdomain}: ${name}`);
      } catch (err) {
        console.warn(`[backup] auto-backup of ${row.id} failed: ${(err as Error).message}`);
      }
    }
  }

  async stop(id: string): Promise<void> {
    this.get(id);
    await this.rcon.disconnect(id);
    await this.docker.stop(id);
    this.repo.setStatus(id, 'stopped');
    // Explicit stop = the server should stay stopped across a manager restart.
    this.repo.setDesiredState(id, 'stopped');
  }

  /**
   * On manager startup, start any server whose desired state is 'running' but
   * whose container isn't currently running (e.g. after STOP_SERVERS_ON_SHUTDOWN,
   * or a container that was removed). Best-effort per server; runs in the
   * background so it never blocks the API coming up.
   */
  async resumeDesiredRunning(): Promise<void> {
    const toResume: ServerRow[] = [];
    for (const row of this.repo.list()) {
      if (row.desired_state !== 'running') continue;
      try {
        if (!(await this.docker.status(row.id)).running) toResume.push(row);
      } catch {
        // Docker unreachable — skip; nothing we can do until it's back.
        return;
      }
    }
    if (toResume.length === 0) return;
    console.log(`[startup] resuming ${toResume.length} server(s) that were running`);
    for (const row of toResume) {
      try {
        await this.start(row.id);
        console.log(`[startup] resumed ${row.subdomain} (${row.id})`);
      } catch (err) {
        console.error(`[startup] failed to resume ${row.id}: ${(err as Error).message}`);
      }
    }
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
