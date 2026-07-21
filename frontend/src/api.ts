import type {
  ApplyResult,
  BackupInfo,
  CatalogEntry,
  DnsSettings,
  ModEntry,
  Modpack,
  ModpackDetail,
  ModpackMod,
  SaveInfo,
  Server,
  ServerStatus,
  SystemStatus,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string } })?.error;
    throw new ApiError(err?.message ?? `HTTP ${res.status}`, err?.code ?? 'ERROR', res.status);
  }
  return json as T;
}

export const api = {
  // auth
  me: () => req<{ authenticated: boolean }>('GET', '/auth/me'),
  login: (password: string) => req<{ ok: boolean }>('POST', '/auth/login', { password }),
  logout: () => req<{ ok: boolean }>('POST', '/auth/logout'),

  // system
  systemStatus: () => req<SystemStatus>('GET', '/system/status'),

  // servers
  listServers: () => req<{ servers: Server[] }>('GET', '/servers'),
  getServer: (id: string) => req<{ server: Server }>('GET', `/servers/${id}`),
  createServer: (input: Record<string, unknown>) =>
    req<{ server: Server }>('POST', '/servers', input),
  updateServer: (id: string, input: Record<string, unknown>) =>
    req<{ server: Server }>('PATCH', `/servers/${id}`, input),
  deleteServer: (id: string) => req<void>('DELETE', `/servers/${id}`),
  getSettings: (id: string) =>
    req<{ settings: Record<string, unknown> }>('GET', `/servers/${id}/settings`),
  updateSettings: (id: string, settings: Record<string, unknown>) =>
    req<{ settings: Record<string, unknown> }>('PUT', `/servers/${id}/settings`, { settings }),

  start: (id: string) => req<{ ok: boolean }>('POST', `/servers/${id}/start`),
  stop: (id: string) => req<{ ok: boolean }>('POST', `/servers/${id}/stop`),
  restart: (id: string) => req<{ ok: boolean }>('POST', `/servers/${id}/restart`),
  status: (id: string) => req<ServerStatus>('GET', `/servers/${id}/status`),
  logs: (id: string, tail = 200) => req<{ logs: string }>('GET', `/servers/${id}/logs?tail=${tail}`),

  // saves
  listSaves: (id: string) =>
    req<{ saves: SaveInfo[]; selected: string }>('GET', `/servers/${id}/saves`),
  createSave: (id: string, name: string) =>
    req<{ name: string; saves: SaveInfo[] }>('POST', `/servers/${id}/saves/create`, { name }),
  selectSave: (id: string, name: string) =>
    req<{ server: Server }>('POST', `/servers/${id}/saves/${encodeURIComponent(name)}/select`),
  restoreSave: (id: string, name: string) =>
    req<{ server: Server }>('POST', `/servers/${id}/saves/${encodeURIComponent(name)}/restore`),
  deleteSave: (id: string, name: string) =>
    req<void>('DELETE', `/servers/${id}/saves/${encodeURIComponent(name)}`),
  uploadSave: async (id: string, file: File, name?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    const res = await fetch(`/api/servers/${id}/saves`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (json as { error?: { code: string; message: string } })?.error;
      throw new ApiError(err?.message ?? `HTTP ${res.status}`, err?.code ?? 'ERROR', res.status);
    }
    return json as { saves: SaveInfo[] };
  },
  downloadSaveUrl: (id: string, name: string) =>
    `/api/servers/${id}/saves/${encodeURIComponent(name)}/download`,

  // backups
  listBackups: (id: string) => req<{ backups: BackupInfo[] }>('GET', `/servers/${id}/backups`),
  backupNow: (id: string, saveName?: string) =>
    req<{ name: string; source: string; backups: BackupInfo[] }>('POST', `/servers/${id}/backups`, {
      saveName,
    }),
  restoreBackup: (id: string, name: string) =>
    req<{ restoredTo: string }>('POST', `/servers/${id}/backups/${encodeURIComponent(name)}/restore`),
  deleteBackup: (id: string, name: string) =>
    req<void>('DELETE', `/servers/${id}/backups/${encodeURIComponent(name)}`),
  downloadBackupUrl: (id: string, name: string) =>
    `/api/servers/${id}/backups/${encodeURIComponent(name)}/download`,

  // mods
  getMods: (id: string) => req<{ mods: ModEntry[] }>('GET', `/servers/${id}/mods`),
  putMods: (id: string, mods: ModEntry[]) =>
    req<{
      mods: ModEntry[];
      downloaded: { name: string; version: string }[];
      errors: { name: string; error: string }[];
    }>('PUT', `/servers/${id}/mods`, { mods }),

  searchMods: (q: string, limit = 25) =>
    req<{ results: CatalogEntry[] }>('GET', `/mods/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // modpacks
  listModpacks: () => req<{ modpacks: Modpack[] }>('GET', '/modpacks'),
  getModpack: (id: string) => req<ModpackDetail>('GET', `/modpacks/${id}`),
  createModpack: (name: string, description?: string) =>
    req<ModpackDetail>('POST', '/modpacks', { name, description }),
  createModpackFromServer: (serverId: string, name: string) =>
    req<ModpackDetail>('POST', '/modpacks/from-server', { serverId, name }),
  importModpack: (manifest: unknown) => req<ModpackDetail>('POST', '/modpacks/import', { manifest }),
  updateModpack: (id: string, fields: { name?: string; description?: string }) =>
    req<{ pack: Modpack }>('PATCH', `/modpacks/${id}`, fields),
  deleteModpack: (id: string) => req<void>('DELETE', `/modpacks/${id}`),
  setModpackMods: (id: string, mods: ModpackMod[]) =>
    req<{ mods: ModpackMod[] }>('PUT', `/modpacks/${id}/mods`, { mods }),
  applyModpack: (id: string, serverId: string) =>
    req<ApplyResult>('POST', `/modpacks/${id}/apply`, { serverId }),
  applyModpackToAll: (id: string) =>
    req<{ results: ApplyResult[] }>('POST', `/modpacks/${id}/apply-all`),
  exportModpackUrl: (id: string) => `/api/modpacks/${id}/export`,

  deleteAllMods: (id: string) => req<{ mods: ModEntry[] }>('POST', `/servers/${id}/mods/deleteAll`),
  updateMods: (id: string) =>
    req<{
      mods: ModEntry[];
      updated: { name: string; version: string }[];
      errors: { name: string; error: string }[];
    }>('POST', `/servers/${id}/mods/update`),
  uploadMod: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/servers/${id}/mods/upload`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (json as { error?: { code: string; message: string } })?.error;
      throw new ApiError(err?.message ?? `HTTP ${res.status}`, err?.code ?? 'ERROR', res.status);
    }
    return json as { name: string; version: string; mods: ModEntry[] };
  },
  exportModsUrl: (id: string) => `/api/servers/${id}/mods/export`,

  // whitelist
  getWhitelist: (id: string) =>
    req<{ whitelist: string[] }>('GET', `/servers/${id}/whitelist`),
  setWhitelist: (id: string, whitelist: string[]) =>
    req<{ whitelist: string[] }>('PUT', `/servers/${id}/whitelist`, { whitelist }),
  getGlobalWhitelist: () => req<{ whitelist: string[] }>('GET', '/global/whitelist'),
  setGlobalWhitelist: (whitelist: string[]) =>
    req<{ whitelist: string[] }>('PUT', '/global/whitelist', { whitelist }),

  // admin list (same shape as whitelist)
  getAdminlist: (id: string) => req<{ adminlist: string[] }>('GET', `/servers/${id}/adminlist`),
  setAdminlist: (id: string, adminlist: string[]) =>
    req<{ adminlist: string[] }>('PUT', `/servers/${id}/adminlist`, { adminlist }),
  getGlobalAdminlist: () => req<{ adminlist: string[] }>('GET', '/global/adminlist'),
  setGlobalAdminlist: (adminlist: string[]) =>
    req<{ adminlist: string[] }>('PUT', '/global/adminlist', { adminlist }),

  // dns / cloudflare
  getDns: () => req<{ dns: DnsSettings }>('GET', '/global/dns'),
  setDns: (patch: Record<string, unknown>) => req<{ dns: DnsSettings }>('PUT', '/global/dns', patch),
  testDns: () =>
    req<{ ok: boolean; zoneName?: string; error?: string }>('POST', '/global/dns/test'),

  // rcon
  rcon: (id: string, command: string) =>
    req<{ response: string }>('POST', `/servers/${id}/rcon`, { command }),
};
