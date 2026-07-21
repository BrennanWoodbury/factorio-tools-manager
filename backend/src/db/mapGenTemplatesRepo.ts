import type { DB, SqlValue } from './index.js';

export interface MapGenTemplateRow {
  id: string;
  name: string;
  description: string;
  settings_json: string; // the map-gen-settings.json object as JSON
  created_at: string;
  updated_at: string;
}

/** Data access for the shared map-generation template registry. */
export class MapGenTemplatesRepo {
  constructor(private readonly db: DB) {}

  insert(row: Pick<MapGenTemplateRow, 'id' | 'name' | 'description' | 'settings_json'>): void {
    this.db
      .prepare(
        `INSERT INTO map_gen_templates (id, name, description, settings_json)
         VALUES (@id, @name, @description, @settings_json)`,
      )
      .run(row as unknown as Record<string, SqlValue>);
  }

  getById(id: string): MapGenTemplateRow | undefined {
    return this.db.prepare<MapGenTemplateRow>('SELECT * FROM map_gen_templates WHERE id = ?').get(id);
  }

  getByName(name: string): MapGenTemplateRow | undefined {
    return this.db.prepare<MapGenTemplateRow>('SELECT * FROM map_gen_templates WHERE name = ?').get(name);
  }

  list(): MapGenTemplateRow[] {
    return this.db.prepare<MapGenTemplateRow>('SELECT * FROM map_gen_templates ORDER BY name ASC').all();
  }

  update(
    id: string,
    fields: Partial<Pick<MapGenTemplateRow, 'name' | 'description' | 'settings_json'>>,
  ): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db
      .prepare(`UPDATE map_gen_templates SET ${setClause}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...fields, id } as unknown as Record<string, SqlValue>);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM map_gen_templates WHERE id = ?').run(id);
  }
}
