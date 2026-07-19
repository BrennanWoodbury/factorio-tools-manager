/** Row shapes as stored in SQLite (snake_case columns). */
export interface ServerRow {
  id: string;
  name: string;
  subdomain: string;
  description: string;
  max_players: number;
  game_port: number;
  rcon_port: number;
  rcon_password: string;
  save_name: string;
  generate_new_save: number; // 0 | 1
  mod_portal_username: string;
  mod_portal_token: string;
  container_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** API-facing server shape (camelCase, secrets stripped where appropriate). */
export interface ServerDto {
  id: string;
  name: string;
  subdomain: string;
  description: string;
  maxPlayers: number;
  gamePort: number;
  rconPort: number;
  saveName: string;
  generateNewSave: boolean;
  hasModPortalCredentials: boolean;
  containerId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Fully-qualified connect hostname players use, when DNS is enabled. */
  connectHost?: string;
}

export function toDto(row: ServerRow, connectHost?: string): ServerDto {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    description: row.description,
    maxPlayers: row.max_players,
    gamePort: row.game_port,
    rconPort: row.rcon_port,
    saveName: row.save_name,
    generateNewSave: row.generate_new_save === 1,
    hasModPortalCredentials: row.mod_portal_username !== '' && row.mod_portal_token !== '',
    containerId: row.container_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    connectHost,
  };
}

export interface DnsRecordRow {
  id: number;
  server_id: string | null;
  type: string;
  name: string;
  cloudflare_record_id: string | null;
  content: string;
  created_at: string;
}
