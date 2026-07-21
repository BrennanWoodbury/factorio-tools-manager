import type { AppConfig } from './config.js';
import { openDb, type DB } from './db/index.js';
import { ServersRepo } from './db/serversRepo.js';
import { ModpacksRepo } from './db/modpacksRepo.js';
import { PortAllocator } from './services/portAllocator.js';
import { ModpackService } from './services/modpackService.js';
import { DockerService } from './services/dockerService.js';
import { DnsService } from './services/dnsService.js';
import { RconService } from './services/rconService.js';
import { ServerManager } from './services/serverManager.js';
import { ModService } from './services/modService.js';
import { DdnsJob } from './jobs/ddns.js';
import { BackupJob } from './jobs/backup.js';

/** Wires up all singletons from config. Built once at startup. */
export interface AppContext {
  config: AppConfig;
  db: DB;
  repo: ServersRepo;
  allocator: PortAllocator;
  docker: DockerService;
  dns: DnsService;
  rcon: RconService;
  mods: ModService;
  modpacks: ModpackService;
  manager: ServerManager;
  ddns: DdnsJob;
  backups: BackupJob;
}

export function buildContext(config: AppConfig): AppContext {
  const db = openDb(config.dbPath);
  const repo = new ServersRepo(db);
  const allocator = new PortAllocator(db, config.gamePortRange, config.rconPortRange);
  const docker = new DockerService(config);
  const dns = new DnsService(db);
  const rcon = new RconService(config);
  const mods = new ModService();
  const modpacksRepo = new ModpacksRepo(db);
  const modpacks = new ModpackService(modpacksRepo, repo, mods);
  const manager = new ServerManager(db, repo, allocator, docker, dns, rcon, config);
  const ddns = new DdnsJob(dns);
  const backups = new BackupJob(manager);
  return { config, db, repo, allocator, docker, dns, rcon, mods, modpacks, manager, ddns, backups };
}
