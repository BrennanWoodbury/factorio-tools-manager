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
  hasFactorioCredentials: boolean;
  containerId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  appliedModpackId: string | null;
  factorioTag: string;
  factorioImage?: string;
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

export interface CatalogEntry {
  name: string;
  title: string;
  owner: string;
  summary: string;
  downloadsCount: number;
  category: string;
  latestVersion?: string;
  factorioVersion?: string;
}

export interface Modpack {
  id: string;
  name: string;
  description: string;
  factorioVersion: string;
  modCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModpackMod {
  name: string;
  enabled: boolean;
  version: string | null;
}

export interface ModpackDetail {
  pack: Modpack;
  mods: ModpackMod[];
  usedBy: { id: string; name: string }[];
}

export interface ApplyResult {
  serverId: string;
  downloaded: { name: string; version: string }[];
  errors: { name: string; error: string }[];
}

export interface DnsSettings {
  baseDomain: string;
  hostRecordName: string;
  cloudflareZoneId: string;
  hasToken: boolean;
  ddnsIntervalSeconds: number;
  ipCheckUrl: string;
  enabled: boolean;
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
