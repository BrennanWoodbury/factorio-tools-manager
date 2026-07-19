export interface Server {
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
  connectHost?: string;
}

export interface ServerStatus {
  id: string;
  status: string;
  running: boolean;
  startedAt?: string;
  players?: { count: number; names: string[] };
  playersError?: string;
}

export interface SaveInfo {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface ModEntry {
  name: string;
  enabled: boolean;
  version?: string;
}

export interface SystemStatus {
  docker: { ok: boolean; error?: string };
  dns: { enabled: boolean; baseDomain: string | null; hostRecord: string | null };
  ddns: {
    enabled: boolean;
    running: boolean;
    lastIp?: string;
    lastCheck?: string;
    lastError?: string;
    intervalSeconds: number;
  };
  ports: {
    game: { range: [number, number]; total: number; used: number; free: number };
    rcon: { range: [number, number]; total: number; used: number; free: number };
  };
}
