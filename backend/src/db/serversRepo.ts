import type { DB, SqlValue } from './index.js';
import type { ServerRow } from './models.js';

type NamedParams = Record<string, SqlValue>;

/** Data access for the `servers` table. Pure persistence, no orchestration. */
export class ServersRepo {
  constructor(private readonly db: DB) {}

  insert(row: ServerRow): void {
    this.db
      .prepare(
        `INSERT INTO servers
          (id, name, subdomain, description, max_players, game_port, rcon_port,
           rcon_password, save_name, generate_new_save, factorio_username,
           factorio_token, factorio_tag, container_id, status, game_mode,
           map_gen_settings_json, map_settings_json,
           lifecycle, expires_at, draft_state_json,
           auto_restart, auto_backup, backup_interval_minutes, backup_keep, backup_keep_manual,
           auto_restart_overridden, auto_backup_overridden, backup_interval_minutes_overridden,
           backup_keep_overridden, backup_keep_manual_overridden)
         VALUES
          (@id, @name, @subdomain, @description, @max_players, @game_port, @rcon_port,
           @rcon_password, @save_name, @generate_new_save, @factorio_username,
           @factorio_token, @factorio_tag, @container_id, @status, @game_mode,
           @map_gen_settings_json, @map_settings_json,
           @lifecycle, @expires_at, @draft_state_json,
           @auto_restart, @auto_backup, @backup_interval_minutes, @backup_keep, @backup_keep_manual,
           @auto_restart_overridden, @auto_backup_overridden, @backup_interval_minutes_overridden,
           @backup_keep_overridden, @backup_keep_manual_overridden)`,
      )
      // node:sqlite supports named params via an object argument
      .run(row as unknown as NamedParams);
  }

  getById(id: string): ServerRow | undefined {
    return this.db.prepare<ServerRow>('SELECT * FROM servers WHERE id = ?').get(id);
  }

  /** Subdomain lookup for uniqueness — active servers only (drafts hold placeholders). */
  getBySubdomain(subdomain: string): ServerRow | undefined {
    return this.db
      .prepare<ServerRow>("SELECT * FROM servers WHERE subdomain = ? AND lifecycle = 'active'")
      .get(subdomain);
  }

  /** Real (active) servers only — the single choke-point that keeps drafts out of
   *  every operational path (listing, ports, DNS, resume-on-boot, backups). */
  list(): ServerRow[] {
    return this.db
      .prepare<ServerRow>("SELECT * FROM servers WHERE lifecycle = 'active' ORDER BY created_at ASC")
      .all();
  }

  /** In-progress wizard drafts, newest activity first (for "Continue new server"). */
  listDrafts(): ServerRow[] {
    return this.db
      .prepare<ServerRow>("SELECT * FROM servers WHERE lifecycle = 'draft' ORDER BY updated_at DESC")
      .all();
  }

  /** Persist wizard state + bump the prune deadline (called as the user progresses). */
  setDraftState(id: string, json: string, expiresAt: string): void {
    this.db
      .prepare(
        "UPDATE servers SET draft_state_json = ?, expires_at = ?, updated_at = datetime('now') " +
          "WHERE id = ? AND lifecycle = 'draft'",
      )
      .run(json, expiresAt, id);
  }

  /** Promote a draft to a real server: claim its subdomain + ports, clear draft state. */
  promoteToActive(id: string, subdomain: string, gamePort: number, rconPort: number): void {
    this.db
      .prepare(
        "UPDATE servers SET lifecycle = 'active', subdomain = ?, game_port = ?, rcon_port = ?, " +
          "expires_at = NULL, draft_state_json = NULL, updated_at = datetime('now') " +
          "WHERE id = ? AND lifecycle = 'draft'",
      )
      .run(subdomain, gamePort, rconPort, id);
  }

  /** Revert a promotion (finalize rolled back, e.g. DNS failed): back to draft, no ports. */
  demoteToDraft(id: string, expiresAt: string): void {
    this.db
      .prepare(
        "UPDATE servers SET lifecycle = 'draft', game_port = 0, rcon_port = 0, expires_at = ?, " +
          "updated_at = datetime('now') WHERE id = ?",
      )
      .run(expiresAt, id);
  }

  /** Delete drafts whose deadline has passed; returns their ids so dirs can be cleaned. */
  deleteExpiredDrafts(nowIso: string): string[] {
    const rows = this.db
      .prepare<{ id: string }>(
        "SELECT id FROM servers WHERE lifecycle = 'draft' AND expires_at IS NOT NULL AND expires_at < ?",
      )
      .all(nowIso);
    for (const { id } of rows) this.db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    return rows.map((r) => r.id);
  }

  setStatus(id: string, status: string, containerId?: string | null): void {
    if (containerId === undefined) {
      this.db
        .prepare("UPDATE servers SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(status, id);
    } else {
      this.db
        .prepare(
          "UPDATE servers SET status = ?, container_id = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(status, containerId, id);
    }
  }

  update(
    id: string,
    fields: Partial<
      Pick<
        ServerRow,
        | 'name'
        | 'description'
        | 'max_players'
        | 'subdomain'
        | 'save_name'
        | 'generate_new_save'
        | 'factorio_username'
        | 'factorio_token'
      >
    >,
  ): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db
      .prepare(
        `UPDATE servers SET ${setClause}, updated_at = datetime('now') WHERE id = @id`,
      )
      .run({ ...fields, id } as unknown as NamedParams);
  }

  setSettingsJson(id: string, json: string): void {
    this.db
      .prepare("UPDATE servers SET settings_json = ?, updated_at = datetime('now') WHERE id = ?")
      .run(json, id);
  }

  setDesiredState(id: string, state: 'running' | 'stopped'): void {
    this.db.prepare('UPDATE servers SET desired_state = ? WHERE id = ?').run(state, id);
  }

  setWhitelistJson(id: string, json: string): void {
    this.db
      .prepare("UPDATE servers SET whitelist_json = ?, updated_at = datetime('now') WHERE id = ?")
      .run(json, id);
  }

  setAdminlistJson(id: string, json: string): void {
    this.db
      .prepare("UPDATE servers SET adminlist_json = ?, updated_at = datetime('now') WHERE id = ?")
      .run(json, id);
  }

  setMapGenSettingsJson(id: string, json: string): void {
    this.db
      .prepare("UPDATE servers SET map_gen_settings_json = ?, updated_at = datetime('now') WHERE id = ?")
      .run(json, id);
  }

  setMapSettingsJson(id: string, json: string | null): void {
    this.db
      .prepare("UPDATE servers SET map_settings_json = ?, updated_at = datetime('now') WHERE id = ?")
      .run(json, id);
  }

  setAppliedModpack(id: string, modpackId: string | null): void {
    this.db
      .prepare("UPDATE servers SET applied_modpack_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(modpackId, id);
  }

  /** Servers currently marked as using a given modpack (for re-apply UI). */
  listByModpack(modpackId: string): ServerRow[] {
    return this.db
      .prepare<ServerRow>('SELECT * FROM servers WHERE applied_modpack_id = ?')
      .all(modpackId);
  }

  delete(id: string): void {
    // port_allocations and dns_records cascade via FK ON DELETE CASCADE.
    this.db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  }
}
