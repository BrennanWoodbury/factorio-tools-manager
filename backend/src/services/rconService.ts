import { Rcon } from 'rcon-client';
import type { AppConfig } from '../config.js';
import type { ServerRow } from '../db/models.js';
import { RconError } from '../lib/errors.js';
import { RCON_PORT_INTERNAL } from './dockerService.js';

interface Target {
  host: string;
  port: number;
  password: string;
}

/**
 * Maintains RCON connections to running servers and exposes command + player
 * queries. Connections are lazy and pooled per server; a dropped connection is
 * transparently re-established on the next call.
 *
 * RCON is never reachable from outside the host: in 'network' mode we dial the
 * Factorio container directly over the shared Docker network; in 'loopback' mode
 * (local dev) we dial 127.0.0.1 on the published RCON port.
 */
export class RconService {
  private pool = new Map<string, Rcon>();

  constructor(private readonly config: AppConfig) {}

  private targetFor(server: ServerRow): Target {
    if (this.config.rconMode === 'loopback') {
      return { host: '127.0.0.1', port: server.rcon_port, password: server.rcon_password };
    }
    // 'network': reach the container by its network alias on the internal port.
    return {
      host: `ftm-${server.id}`,
      port: RCON_PORT_INTERNAL,
      password: server.rcon_password,
    };
  }

  private async connect(server: ServerRow): Promise<Rcon> {
    const existing = this.pool.get(server.id);
    if (existing) return existing;
    const t = this.targetFor(server);
    let rcon: Rcon;
    try {
      rcon = await Rcon.connect({ host: t.host, port: t.port, password: t.password });
    } catch (err) {
      throw new RconError(`connect to ${t.host}:${t.port} failed: ${(err as Error).message}`);
    }
    rcon.on('end', () => this.pool.delete(server.id));
    rcon.on('error', () => this.pool.delete(server.id));
    this.pool.set(server.id, rcon);
    return rcon;
  }

  /** Send a raw command string and return the server's textual response. */
  async send(server: ServerRow, command: string): Promise<string> {
    const rcon = await this.connect(server);
    try {
      return await rcon.send(command);
    } catch (err) {
      // Drop a possibly-broken connection so the next call reconnects.
      this.pool.delete(server.id);
      try {
        await rcon.end();
      } catch {
        /* ignore */
      }
      throw new RconError(`command failed: ${(err as Error).message}`);
    }
  }

  /**
   * Query the online player list. Uses Factorio's `/players online` console
   * command and parses its output:
   *   "Online players (2):\n  alice (online)\n  bob (online)"
   */
  async players(server: ServerRow): Promise<{ count: number; names: string[] }> {
    const raw = await this.send(server, '/players online');
    const names: string[] = [];
    let declared: number | undefined;
    for (const line of raw.split('\n')) {
      const header = /Online players \((\d+)\)/i.exec(line);
      if (header) {
        declared = Number.parseInt(header[1], 10);
        continue;
      }
      const name = line.trim().replace(/\s*\(online\)\s*$/i, '').trim();
      if (name) names.push(name);
    }
    return { count: declared ?? names.length, names };
  }

  /** Close a server's connection (on stop/delete). Idempotent. */
  async disconnect(serverId: string): Promise<void> {
    const rcon = this.pool.get(serverId);
    if (!rcon) return;
    this.pool.delete(serverId);
    try {
      await rcon.end();
    } catch {
      /* ignore */
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.pool.keys()].map((id) => this.disconnect(id)));
  }
}
