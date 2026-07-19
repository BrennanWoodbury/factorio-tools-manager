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
           rcon_password, save_name, generate_new_save, mod_portal_username,
           mod_portal_token, container_id, status)
         VALUES
          (@id, @name, @subdomain, @description, @max_players, @game_port, @rcon_port,
           @rcon_password, @save_name, @generate_new_save, @mod_portal_username,
           @mod_portal_token, @container_id, @status)`,
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
        | 'mod_portal_username'
        | 'mod_portal_token'
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

  delete(id: string): void {
    // port_allocations and dns_records cascade via FK ON DELETE CASCADE.
    this.db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  }
}
