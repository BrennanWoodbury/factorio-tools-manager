import type { ModEntry, SaveInfo, Server, ServerStatus, SystemStatus } from './types';

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
  start: (id: string) => req<{ ok: boolean }>('POST', `/servers/${id}/start`),
  stop: (id: string) => req<{ ok: boolean }>('POST', `/servers/${id}/stop`),
  restart: (id: string) => req<{ ok: boolean }>('POST', `/servers/${id}/restart`),
  status: (id: string) => req<ServerStatus>('GET', `/servers/${id}/status`),
  logs: (id: string, tail = 200) => req<{ logs: string }>('GET', `/servers/${id}/logs?tail=${tail}`),

  // saves
  listSaves: (id: string) =>
    req<{ saves: SaveInfo[]; selected: string }>('GET', `/servers/${id}/saves`),
  selectSave: (id: string, name: string) =>
    req<{ server: Server }>('POST', `/servers/${id}/saves/${encodeURIComponent(name)}/select`),
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

  // mods
  getMods: (id: string) => req<{ mods: ModEntry[] }>('GET', `/servers/${id}/mods`),
  putMods: (id: string, mods: ModEntry[]) =>
    req<{
      mods: ModEntry[];
      downloaded: { name: string; version: string }[];
      errors: { name: string; error: string }[];
    }>('PUT', `/servers/${id}/mods`, { mods }),

  // rcon
  rcon: (id: string, command: string) =>
    req<{ response: string }>('POST', `/servers/${id}/rcon`, { command }),
};
