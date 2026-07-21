import Docker from 'dockerode';
import { randomBytes } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { ServerRow } from '../db/models.js';
import { DockerError } from '../lib/errors.js';

/**
 * Internal (container-side) RCON port. RCON is never forwarded externally, so its
 * container port is fixed and every container can share it (they're in separate
 * network namespaces); the manager reaches each one by its unique network alias.
 *
 * The GAME port, by contrast, is bound inside the container to the server's own
 * allocated port (via the image's PORT env → `--port`) and published 1:1 to the
 * host, so external == host == container == the SRV-advertised port with no
 * translation anywhere. That end-to-end match is required for Factorio's public
 * server listing / NAT punch-through to advertise the reachable port.
 */
export const RCON_PORT_INTERNAL = 27015;

export const MANAGED_LABEL = 'factorio-manager.managed';
export const SERVER_ID_LABEL = 'factorio-manager.server-id';

export interface ContainerStatus {
  exists: boolean;
  running: boolean;
  startedAt?: string;
  state?: string;
}

/**
 * Wraps dockerode to create/start/stop/remove the per-server Factorio containers.
 *
 * Port mapping (the crux of the networking model):
 *   - game: <allocatedGamePort>:<allocatedGamePort>/udp — Factorio inside the
 *     container binds the same allocated port (PORT env → `--port`), and it's
 *     published 1:1 on 0.0.0.0. So external == host == container == advertised SRV
 *     port with no translation, which keeps Factorio's public listing / NAT
 *     punch-through pointing at the actually-reachable port.
 *   - rcon: 127.0.0.1:<allocatedRconPort>:27015/tcp — published only on host
 *     loopback, never externally, never in DNS.
 * Additionally every Factorio container joins a shared user-defined network so the
 * (containerised) manager can reach RCON at <containerName>:27015 without relying
 * on host loopback at all.
 */
export class DockerService {
  private readonly docker: Docker;

  constructor(private readonly config: AppConfig) {
    this.docker = new Docker({ socketPath: config.dockerSocket });
  }

  /** Deterministic container name; also used as the RCON network hostname. */
  containerName(serverId: string): string {
    return `ftm-${serverId}`;
  }

  /**
   * Resolve the Docker image for a server. A per-server `factorio_tag` overrides
   * just the tag of the configured base repo (e.g. FACTORIO_IMAGE
   * `factoriotools/factorio:stable` + tag `latest` => `factoriotools/factorio:latest`);
   * empty tag uses the global image as-is.
   */
  imageFor(server: ServerRow): string {
    const tag = (server.factorio_tag ?? '').trim();
    if (!tag) return this.config.factorioImage;
    const base = this.config.factorioImage;
    // Split off the existing tag, being careful not to treat a registry port
    // (host:5000/...) as a tag: the tag colon must come after the last slash.
    const lastColon = base.lastIndexOf(':');
    const lastSlash = base.lastIndexOf('/');
    const repo = lastColon > lastSlash ? base.slice(0, lastColon) : base;
    return `${repo}:${tag}`;
  }

  /**
   * Ensure an image is available, pulling on EVERY call so moving tags (stable,
   * latest) pick up updates on each container (re)create. If the pull fails but we
   * already have a local copy (e.g. registry unreachable / offline), we proceed
   * with the local image rather than blocking the start.
   */
  async ensureImage(image: string): Promise<void> {
    try {
      console.log(`[docker] pulling ${image} (checking for updates) …`);
      await this.pullImage(image);
      console.log(`[docker] ${image} up to date`);
    } catch (pullErr) {
      try {
        await this.docker.getImage(image).inspect();
        console.warn(
          `[docker] pull ${image} failed (${(pullErr as Error).message}); using local copy`,
        );
      } catch {
        throw pullErr instanceof DockerError
          ? pullErr
          : new DockerError(`image ${image} unavailable: ${(pullErr as Error).message}`);
      }
    }
  }

  private pullImage(image: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err || !stream) {
          reject(new DockerError(`pull ${image} failed: ${err?.message ?? 'no stream'}`));
          return;
        }
        this.docker.modem.followProgress(stream, (doneErr: Error | null) =>
          doneErr ? reject(new DockerError(`pull ${image} failed: ${doneErr.message}`)) : resolve(),
        );
      });
    });
  }

  /**
   * Gracefully stop every running container this manager created (identified by
   * the managed label). Stops happen in parallel so total time ≈ one container's
   * stop timeout. Used on manager shutdown. Returns how many were stopped.
   */
  async stopAllManaged(timeoutSecs = 30): Promise<number> {
    const list = await this.docker.listContainers({
      filters: { label: [`${MANAGED_LABEL}=true`] },
    });
    await Promise.all(
      list.map(async (c) => {
        try {
          await this.docker.getContainer(c.Id).stop({ t: timeoutSecs });
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code !== 304 && code !== 404) {
            console.warn(`[docker] stop ${c.Names?.[0] ?? c.Id} failed: ${(err as Error).message}`);
          }
        }
      }),
    );
    return list.length;
  }

  async ping(): Promise<void> {
    try {
      await this.docker.ping();
    } catch (err) {
      throw new DockerError(`daemon unreachable: ${(err as Error).message}`);
    }
  }

  /** Create the shared bridge network if it doesn't already exist. */
  async ensureNetwork(): Promise<void> {
    const name = this.config.factorioNetwork;
    try {
      const networks = await this.docker.listNetworks({ filters: { name: [name] } });
      if (networks.some((n) => n.Name === name)) return;
      await this.docker.createNetwork({ Name: name, Driver: 'bridge', CheckDuplicate: true });
      console.log(`[docker] created network ${name}`);
    } catch (err) {
      throw new DockerError(`ensureNetwork failed: ${(err as Error).message}`);
    }
  }

  private envFor(server: ServerRow): string[] {
    const env: Record<string, string> = {
      SAVE_NAME: server.save_name,
      GENERATE_NEW_SAVE: server.generate_new_save === 1 ? 'true' : 'false',
      LOAD_LATEST_SAVE: 'false',
      // Bind Factorio inside the container to the server's own allocated game port
      // so it matches the host/external/SRV port 1:1 (no translation). RCON stays on
      // the fixed internal port (loopback/Docker-network only, never forwarded).
      PORT: String(server.game_port),
      RCON_PORT: String(RCON_PORT_INTERNAL),
      RCON_PASSWORD: server.rcon_password,
      // We manage mods ourselves via the Mod Portal API, so keep the image from
      // trying to update them on boot (which would also fail without creds).
      UPDATE_MODS_ON_START: 'false',
    };
    if (server.factorio_username && server.factorio_token) {
      env.USERNAME = server.factorio_username;
      env.TOKEN = server.factorio_token;
    }
    if (this.config.puid) env.PUID = this.config.puid;
    if (this.config.pgid) env.PGID = this.config.pgid;
    return Object.entries(env).map(([k, v]) => `${k}=${v}`);
  }

  /**
   * Create (but do not start) the container for a server. `hostDataDir` must be
   * the path as the *Docker daemon* sees it (the host path), not the manager's
   * in-container view. Returns the container id.
   */
  async createContainer(server: ServerRow, hostDataDir: string): Promise<string> {
    const gamePort = String(server.game_port);
    const rconPort = String(server.rcon_port);
    const image = this.imageFor(server);
    await this.ensureImage(image);
    try {
      const container = await this.docker.createContainer({
        name: this.containerName(server.id),
        Image: image,
        Env: this.envFor(server),
        ExposedPorts: {
          [`${gamePort}/udp`]: {},
          [`${RCON_PORT_INTERNAL}/tcp`]: {},
        },
        Labels: {
          [MANAGED_LABEL]: 'true',
          [SERVER_ID_LABEL]: server.id,
        },
        HostConfig: {
          Binds: [`${hostDataDir}:/factorio`],
          PortBindings: {
            // 1:1 — container game port == host game port == external/SRV port.
            [`${gamePort}/udp`]: [{ HostIp: '0.0.0.0', HostPort: gamePort }],
            // RCON published on host loopback only.
            [`${RCON_PORT_INTERNAL}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: rconPort }],
          },
          RestartPolicy: { Name: 'unless-stopped' },
        },
        NetworkingConfig: {
          EndpointsConfig: {
            [this.config.factorioNetwork]: {
              Aliases: [this.containerName(server.id)],
            },
          },
        },
      });
      return container.id;
    } catch (err) {
      throw new DockerError(`createContainer failed: ${(err as Error).message}`);
    }
  }

  /**
   * Run the Factorio binary once to completion in a throwaway container (used for
   * offline operations like creating a save). The image entrypoint is overridden
   * to invoke the binary directly with `args`, the server's data dir is bind-
   * mounted at /factorio, no ports are published, and the container is removed
   * afterwards. Returns the exit code and combined logs.
   */
  async runOneShot(
    server: ServerRow,
    hostDataDir: string,
    args: string[],
    timeoutMs = 120_000,
  ): Promise<{ exitCode: number; logs: string }> {
    const name = `${this.containerName(server.id)}-job-${randomBytes(4).toString('hex')}`;
    const image = this.imageFor(server);
    await this.ensureImage(image);
    let container: Docker.Container | undefined;
    try {
      container = await this.docker.createContainer({
        name,
        Image: image,
        Entrypoint: ['/opt/factorio/bin/x64/factorio'],
        Cmd: args,
        Labels: { [MANAGED_LABEL]: 'true', [SERVER_ID_LABEL]: server.id },
        HostConfig: {
          Binds: [`${hostDataDir}:/factorio`],
          AutoRemove: false,
        },
      });
      await container.start();
      const timer = setTimeout(() => void container?.stop({ t: 5 }).catch(() => {}), timeoutMs);
      const result = (await container.wait()) as { StatusCode: number };
      clearTimeout(timer);
      const logs = await this.readContainerLogs(container);
      return { exitCode: result.StatusCode, logs };
    } catch (err) {
      throw new DockerError(`one-shot job failed: ${(err as Error).message}`);
    } finally {
      if (container) await container.remove({ force: true, v: false }).catch(() => {});
    }
  }

  private async readContainerLogs(container: Docker.Container): Promise<string> {
    const buf = (await container.logs({
      stdout: true,
      stderr: true,
      tail: 200,
      follow: false,
    })) as unknown as Buffer;
    return stripDockerLogHeader(buf);
  }

  async start(serverId: string): Promise<void> {
    await this.withContainer(serverId, (c) => c.start());
  }

  async stop(serverId: string): Promise<void> {
    // Graceful stop; Factorio saves on SIGTERM. Allow up to 30s.
    await this.withContainer(serverId, (c) => c.stop({ t: 30 }).catch((e: { statusCode?: number }) => {
      // 304 = already stopped; treat as success.
      if (e.statusCode === 304) return;
      throw e;
    }));
  }

  async restart(serverId: string): Promise<void> {
    await this.withContainer(serverId, (c) => c.restart({ t: 30 }));
  }

  async remove(serverId: string): Promise<void> {
    try {
      const c = this.docker.getContainer(this.containerName(serverId));
      await c.remove({ force: true, v: false });
    } catch (err) {
      const e = err as { statusCode?: number };
      if (e.statusCode === 404) return; // already gone
      throw new DockerError(`remove failed: ${(err as Error).message}`);
    }
  }

  async status(serverId: string): Promise<ContainerStatus> {
    try {
      const c = this.docker.getContainer(this.containerName(serverId));
      const info = await c.inspect();
      return {
        exists: true,
        running: info.State.Running === true,
        startedAt: info.State.StartedAt,
        state: info.State.Status,
      };
    } catch (err) {
      const e = err as { statusCode?: number };
      if (e.statusCode === 404) return { exists: false, running: false };
      throw new DockerError(`status failed: ${(err as Error).message}`);
    }
  }

  /** Tail recent container logs (for surfacing start failures like a bad mod). */
  async logs(serverId: string, tail = 200): Promise<string> {
    try {
      const c = this.docker.getContainer(this.containerName(serverId));
      const buf = (await c.logs({
        stdout: true,
        stderr: true,
        tail,
        follow: false,
      })) as unknown as Buffer;
      return stripDockerLogHeader(buf);
    } catch (err) {
      throw new DockerError(`logs failed: ${(err as Error).message}`);
    }
  }

  private async withContainer(serverId: string, fn: (c: Docker.Container) => Promise<unknown>) {
    try {
      const c = this.docker.getContainer(this.containerName(serverId));
      await fn(c);
    } catch (err) {
      if (err instanceof DockerError) throw err;
      throw new DockerError((err as Error).message);
    }
  }
}

/**
 * Docker multiplexes stdout/stderr with an 8-byte header per frame when no TTY.
 * Strip those headers to recover readable text.
 */
function stripDockerLogHeader(buf: Buffer): string {
  const out: string[] = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 8 > buf.length) break;
    const len = buf.readUInt32BE(i + 4);
    const start = i + 8;
    const end = start + len;
    out.push(buf.toString('utf8', start, Math.min(end, buf.length)));
    i = end;
  }
  const text = out.join('');
  // Fallback: if it didn't look framed, return raw.
  return text.length > 0 ? text : buf.toString('utf8');
}
