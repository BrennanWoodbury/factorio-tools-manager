import type { DB, SqlValue } from './index.js';

export interface ModpackRow {
  id: string;
  name: string;
  description: string;
  factorio_version: string;
  created_at: string;
  updated_at: string;
}

export interface ModpackModRow {
  modpack_id: string;
  name: string;
  enabled: number; // 0 | 1
  version: string | null; // null = latest
}

/** Data access for the shared modpack registry (`modpacks` + `modpack_mods`). */
export class ModpacksRepo {
  constructor(private readonly db: DB) {}

  insert(row: Pick<ModpackRow, 'id' | 'name' | 'description' | 'factorio_version'>): void {
    this.db
      .prepare(
        `INSERT INTO modpacks (id, name, description, factorio_version)
         VALUES (@id, @name, @description, @factorio_version)`,
      )
      .run(row as unknown as Record<string, SqlValue>);
  }

  getById(id: string): ModpackRow | undefined {
    return this.db.prepare<ModpackRow>('SELECT * FROM modpacks WHERE id = ?').get(id);
  }

  getByName(name: string): ModpackRow | undefined {
    return this.db.prepare<ModpackRow>('SELECT * FROM modpacks WHERE name = ?').get(name);
  }

  list(): ModpackRow[] {
    return this.db.prepare<ModpackRow>('SELECT * FROM modpacks ORDER BY name ASC').all();
  }

  update(id: string, fields: Partial<Pick<ModpackRow, 'name' | 'description' | 'factorio_version'>>): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db
      .prepare(`UPDATE modpacks SET ${setClause}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...fields, id } as unknown as Record<string, SqlValue>);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM modpacks WHERE id = ?').run(id);
  }

  // ---- pack contents ----

  listMods(modpackId: string): ModpackModRow[] {
    return this.db
      .prepare<ModpackModRow>('SELECT * FROM modpack_mods WHERE modpack_id = ? ORDER BY name ASC')
      .all(modpackId);
  }

  countMods(modpackId: string): number {
    const row = this.db
      .prepare<{ n: number }>('SELECT COUNT(*) AS n FROM modpack_mods WHERE modpack_id = ?')
      .get(modpackId);
    return row?.n ?? 0;
  }

  /** Replace all mods in a pack atomically. */
  replaceMods(
    modpackId: string,
    mods: { name: string; enabled: boolean; version?: string | null }[],
  ): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM modpack_mods WHERE modpack_id = ?').run(modpackId);
      const stmt = this.db.prepare(
        'INSERT INTO modpack_mods (modpack_id, name, enabled, version) VALUES (?, ?, ?, ?)',
      );
      for (const m of mods) {
        stmt.run(modpackId, m.name, m.enabled ? 1 : 0, m.version ?? null);
      }
      this.db
        .prepare("UPDATE modpacks SET updated_at = datetime('now') WHERE id = ?")
        .run(modpackId);
    })();
  }
}
