# Factorio Multi-Server Manager

Self-hosted web app to run **many Factorio dedicated servers on one home host** behind a
consumer NAT router. Each server is reachable by players at its own subdomain
(`factory1.mydomain.com`) with **no port number to type** and **no reverse proxy** — the
routing is done entirely by DNS **SRV records**.

- Backend: Node.js + TypeScript (Express, `dockerode`, `node:sqlite`, `rcon-client`)
- Frontend: React + TypeScript (Vite)
- DNS/DDNS: Cloudflare REST API
- Runs as a single container that manages sibling Factorio containers via the Docker socket.

---

## How the networking works (read this first)

Factorio's client (v1.1.67+) resolves connections via DNS SRV records. When a player enters
`factory1.mydomain.com`, the client looks up:

```
_factorio._udp.factory1.mydomain.com   SRV   0 0 <gamePort>   host.mydomain.com
```

and connects to `host.mydomain.com:<gamePort>` over UDP. So:

1. **One SRV record per server**, created/updated/removed automatically by this app. Its
   `target` is always the single stable hostname `host.mydomain.com` (SRV targets must be a
   hostname, never an IP or CNAME), and its `port` is that server's unique game port.
2. **One shared A record** `host.mydomain.com` points at your current public IP. Because your
   home IP is dynamic, a background **DDNS job** keeps that one A record in sync. Every server's
   SRV points at it, so a single update follows the WAN IP for all servers at once.
3. **Ports are 1:1, never translated.** You forward a contiguous UDP range **once, by hand** on
   your router to this host. The app only ever allocates game ports from inside that range, and
   the port it advertises in the SRV record is exactly the host port the container publishes.
   `external port == host port == SRV port`.

**RCON** (server admin protocol) is treated completely separately: allocated from its own range,
published only on host loopback (`127.0.0.1`) and reached by the backend over the internal Docker
network. It is **never forwarded and never appears in DNS**.

> Players on Factorio clients older than 1.1.67 don't do SRV lookups and would have to enter
> `host.mydomain.com:<port>` manually. That's an inherent limitation of the SRV approach.

---

## One-time setup

### 1. Forward a UDP port range on your router (manual, once)

In your router's NAT / port-forwarding settings, forward a **contiguous UDP range** to this
host's LAN IP, using the **same** external and internal ports:

| Setting        | Value                                            |
| -------------- | ------------------------------------------------ |
| Protocol       | **UDP**                                           |
| External ports | `34197-34297` (or whatever you set `GAME_PORT_RANGE` to) |
| Internal IP    | your host's LAN IP (e.g. `192.168.1.50`)         |
| Internal ports | `34197-34297` (same range — do **not** remap)    |

Do **not** forward the RCON range. The app never allocates a game port outside this range, so any
server it creates is guaranteed reachable.

### 2. Cloudflare API token (optional — enables DNS automation)

Skip this to run without DNS (players connect by `IP:port`). To enable automatic SRV + DDNS:

1. Your domain's DNS must be managed by Cloudflare.
2. Create an API token at **Cloudflare → My Profile → API Tokens → Create Token → Custom token**
   with:
   - **Permissions:** `Zone` → `DNS` → `Edit`
   - **Zone Resources:** `Include` → `Specific zone` → *your domain*
3. Find your **Zone ID** on the domain's Cloudflare overview page.

The app creates DNS-only (unproxied) records — it never enables the orange-cloud proxy, which
can't carry Factorio's UDP protocol.

### 3. Configure and launch

```bash
cp .env.example .env
# edit .env — at minimum set ADMIN_PASSWORD and HOST_SERVERS_DIR
docker compose up -d --build
```

Open `http://<host>:8080` and log in with `ADMIN_PASSWORD`.

> **`HOST_SERVERS_DIR` must be the absolute host path to `./data/servers`.** The manager runs in
> a container but creates Factorio containers on the host Docker daemon, which needs the real host
> path for their bind mounts. Example: `HOST_SERVERS_DIR=/home/you/factorio-manager/data/servers`.

---

## Environment variables

| Variable                | Required | Default                        | Meaning |
| ----------------------- | -------- | ------------------------------ | ------- |
| `ADMIN_PASSWORD`        | ✅       | —                              | Web UI login password |
| `JWT_SECRET`            |          | derived                        | Signs session cookies; set your own (`openssl rand -hex 32`) |
| `HOST_SERVERS_DIR`      | ✅ (docker) | —                           | Absolute **host** path to `./data/servers` |
| `DATA_DIR`              |          | `/data`                        | Where the SQLite DB + server data live (in-container) |
| `GAME_PORT_RANGE`       |          | `34197-34297`                  | Pre-forwarded UDP game-port pool |
| `RCON_PORT_RANGE`       |          | `27015-27115`                  | Loopback-only RCON port pool |
| `FACTORIO_IMAGE`        |          | `factoriotools/factorio:stable`| Base game server image |
| `FACTORIO_NETWORK`      |          | `factorio-net`                 | Shared Docker network for manager↔RCON |
| `RCON_MODE`             |          | `network`                      | `network` (containerized) or `loopback` (local dev) |
| `PUID` / `PGID`         |          | `845`                          | UID/GID the Factorio image runs as |
| `CLOUDFLARE_API_TOKEN`  |          | *(empty = DNS off)*            | Enables Cloudflare DNS + DDNS |
| `CLOUDFLARE_ZONE_ID`    | if DNS   | —                              | Zone ID of your domain |
| `BASE_DOMAIN`           | if DNS   | —                              | e.g. `mydomain.com` |
| `HOST_RECORD_NAME`      | if DNS   | —                              | Shared SRV target + A record, e.g. `host.mydomain.com` |
| `DDNS_INTERVAL_SECONDS` |          | `300`                          | Public-IP check interval |
| `IP_CHECK_URL`          |          | `https://api.ipify.org`        | External "what's my IP" service |

---

## Using it

- **Create a server:** name + subdomain (+ optional max players, description, mod-portal creds).
  Ports are allocated atomically and, if DNS is on, the SRV record is created.
- **Lifecycle:** start / stop / restart / delete. Delete removes the container, DNS record,
  releases the ports and deletes the data dir.
- **Console:** live RCON console + player list (over loopback / Docker network only).
- **Saves:** upload a `.zip`, list, pick which to load next, download, delete.
- **Mods:** edit the mod list; with mod-portal credentials, enabled mods are downloaded from the
  Factorio Mod Portal. Changes apply on next start.

### Mods: why the Mod Portal API (not `UPDATE_MODS_ON_START`)

The manager downloads mods directly via the [Factorio Mod Portal API] instead of relying on the
image's `UPDATE_MODS_ON_START`. This lets it **validate a mod name and surface download failures
in the UI before the container starts**, rather than discovering a bad mod from a crash loop in
container logs, and gives deterministic control over versions. Tradeoff: more code, and we handle
mod-portal auth ourselves. Automatic dependency resolution is out of MVP scope — enabling a mod
downloads that mod's latest release only.

[Factorio Mod Portal API]: https://wiki.factorio.com/Mod_portal_API

---

## Local development

```bash
# Backend (serves API on :8080). RCON_MODE=loopback so it reaches published RCON ports.
cd backend
npm install
ADMIN_PASSWORD=dev RCON_MODE=loopback DATA_DIR=./data npm run dev

# Frontend (Vite dev server on :5173, proxies /api → :8080)
cd frontend
npm install
npm run dev
```

Run the port-allocator unit tests:

```bash
cd backend && npm test
```

---

## Architecture / data model

```
frontend/  React SPA (built and served by the backend in production)
backend/
  src/
    config.ts            env-driven config
    db/                  node:sqlite + schema + repos
    services/
      portAllocator.ts   atomic game/RCON port allocation (unit-tested)
      dockerService.ts   create/start/stop/remove Factorio containers (dockerode)
      dnsService.ts      Cloudflare SRV records + shared host A record
      rconService.ts     pooled RCON connections (loopback / docker network)
      serverFiles.ts     per-server data dir, saves, server-settings.json, mod-list.json
      modService.ts      Mod Portal API downloads
      serverManager.ts   lifecycle orchestration (ties it all together)
    jobs/ddns.ts         periodic public-IP → A-record sync
    routes/              REST API (auth, servers, system)
```

**SQLite tables:** `servers` (identity/config), `port_allocations` (atomic port registry, PK
`(kind, port)` makes double-allocation impossible), `dns_records` (Cloudflare record bookkeeping
for reconcile/cleanup), `kv` (singletons like last public IP / host A-record id).

### REST API (all under `/api`, session-cookie auth except `/auth/*`)

| Method | Path | |
| --- | --- | --- |
| POST | `/auth/login` `/auth/logout` · GET `/auth/me` | auth |
| GET | `/system/status` | docker/dns/ddns health + port capacity |
| GET/POST | `/servers` | list / create |
| GET/PATCH/DELETE | `/servers/:id` | detail / update / delete |
| POST | `/servers/:id/{start,stop,restart}` | lifecycle |
| GET | `/servers/:id/status` | live state + players |
| GET | `/servers/:id/logs` | container logs |
| GET/POST/DELETE | `/servers/:id/saves[...]` | list / upload / select / download / delete |
| GET/PUT | `/servers/:id/mods` | get / apply mod list |
| POST | `/servers/:id/rcon` | run an RCON command |

---

## Error handling

Realistic failure modes return structured JSON errors (`{ error: { code, message } }`):

- **Port pool exhausted** → `409 PORT_POOL_EXHAUSTED`
- **Duplicate subdomain** → `409 DUPLICATE_SUBDOMAIN`
- **Cloudflare API failure** → `502 CLOUDFLARE_ERROR` (server creation is rolled back so no ports
  are left claimed for an unreachable server)
- **Docker daemon unreachable** → `502 DOCKER_ERROR`
- **Container fails to start / bad mod** → surfaced via the container **logs** endpoint; mod
  download errors are reported per-mod when applying a mod list
- **Validation** (bad subdomain label, save name, etc.) → `400 VALIDATION`

---

## Security notes

- The UI can start/stop/delete infrastructure — it's gated by a single admin login. Put it behind
  TLS (reverse proxy) and set `FORCE_SECURE_COOKIE=true` for production.
- RCON is never exposed off-host.
- The Docker socket is mounted into the manager (root-equivalent on the host) — treat access to
  the UI accordingly.
