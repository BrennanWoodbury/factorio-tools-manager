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
  factorio_username: string;
  factorio_token: string;
  container_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  /** Full editable server-settings.json body (advanced fields only). Nullable
   *  until first edited; defaulted in code. Added in migration v1. */
  settings_json: string | null;
  /** Modpack last applied to this server (for display / re-apply). Migration v2. */
  applied_modpack_id: string | null;
  /** Per-server player whitelist as a JSON string array. Migration v4. */
  whitelist_json: string | null;
  /** Per-server Factorio image tag; empty/null => global default. Migration v5. */
  factorio_tag: string | null;
  /** 1 = auto-restart on restart-requiring config change. Migration v6. */
  auto_restart: number;
  /** Per-server admin list as a JSON string array. Migration v7. */
  adminlist_json: string | null;
  /** User's intended run state: 'running' | 'stopped'. Migration v8. */
  desired_state: string;
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
  hasFactorioCredentials: boolean;
  containerId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  appliedModpackId: string | null;
  /** Per-server image tag ('' = global default). */
  factorioTag: string;
  autoRestart: boolean;
  /** Resolved Docker image the server will run (repo:tag). */
  factorioImage?: string;
  /** Fully-qualified connect hostname players use, when DNS is enabled. */
  connectHost?: string;
}

export function toDto(row: ServerRow, connectHost?: string, factorioImage?: string): ServerDto {
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
    hasFactorioCredentials: row.factorio_username !== '' && row.factorio_token !== '',
    containerId: row.container_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedModpackId: row.applied_modpack_id ?? null,
    factorioTag: row.factorio_tag ?? '',
    autoRestart: row.auto_restart === 1,
    factorioImage,
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
