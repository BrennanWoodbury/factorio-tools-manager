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
           auto_restart, auto_backup, backup_interval_minutes, backup_keep, backup_keep_manual,
           auto_restart_overridden, auto_backup_overridden, backup_interval_minutes_overridden,
           backup_keep_overridden, backup_keep_manual_overridden)
         VALUES
          (@id, @name, @subdomain, @description, @max_players, @game_port, @rcon_port,
           @rcon_password, @save_name, @generate_new_save, @factorio_username,
           @factorio_token, @factorio_tag, @container_id, @status, @game_mode,
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

  getBySubdomain(subdomain: string): ServerRow | undefined {
    return this.db
      .prepare<ServerRow>('SELECT * FROM servers WHERE subdomain = ?')
      .get(subdomain);
  }

  list(): ServerRow[] {
    return this.db.prepare<ServerRow>('SELECT * FROM servers ORDER BY created_at ASC').all();
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
