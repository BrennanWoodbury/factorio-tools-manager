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
3. **Ports are 1:1, never translated — all the way to the container.** You forward a contiguous
   UDP range **once, by hand** on your router to this host. The app only ever allocates game ports
   from inside that range, advertises exactly that port in the SRV record, publishes it on the same
   host port, and binds Factorio *inside* the container to that same port (via the image's `PORT`
   → `--port`). So `external port == host port == container port == SRV port`, with no rewriting at
   any hop. That end-to-end match is what keeps Factorio's public server listing / NAT
   punch-through pointed at the port players can actually reach.

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

### 2. Cloudflare DNS (optional — configured in the dashboard, not env)

Skip this to run without DNS (players connect by `IP:port`). To enable automatic SRV + DDNS,
open the dashboard → **DNS / Cloudflare settings** and enter your base domain, host record, Zone
ID and API token (with a **Test connection** button). It saves to the app's database and takes
effect immediately — no restart, nothing in `.env`. To get the values:

1. Your domain's DNS must be managed by Cloudflare.
2. Create an API token at **Cloudflare → My Profile → API Tokens → Create Token → Custom token**
   with **Permissions:** `Zone` → `DNS` → `Edit`, **Zone Resources:** `Include` → `Specific zone`
   → *your domain*.
3. Find your **Zone ID** on the domain's Cloudflare overview page.

The app creates DNS-only (unproxied) records — it never enables the orange-cloud proxy, which
can't carry Factorio's UDP protocol.

### 3. Configure and launch

```bash
cp .env.example .env
# edit .env — at minimum set ADMIN_PASSWORD (that's the only required var)
docker compose up -d --build
```

Open `http://<host>:8080` and log in with `ADMIN_PASSWORD`.

> **Data location.** Persistent data (SQLite DB + per-server saves/mods/config) is stored at
> `/opt/factorio-tools-manager`, bind-mounted at the *same* path inside and outside the container.
> That identity is deliberate: it makes the host path the Factorio containers bind-mount
> (`<data>/servers/<id>`) valid on the host with no extra configuration. Override with `FTM_DATA_DIR`
> (e.g. `FTM_DATA_DIR=$HOME/.factorio-tools-manager`).

---

## Environment variables

| Variable                | Required | Default                        | Meaning |
| ----------------------- | -------- | ------------------------------ | ------- |
| `ADMIN_PASSWORD`        | ✅       | —                              | Web UI login password |
| `WEB_PORT`              |          | `8080` (prod) / `5173` (dev)   | Host port for the web UI; `API_PORT` (dev only) for the backend |
| `JWT_SECRET`            |          | derived                        | Signs session cookies; set your own (`openssl rand -hex 32`) |
| `FTM_DATA_DIR`          |          | `/opt/factorio-tools-manager`  | Data location; identity-mounted host↔container (prod compose) |
| `DATA_DIR`              |          | `FTM_DATA_DIR`                 | In-container data path (host-mode dev defaults to `../data`) |
| `HOST_SERVERS_DIR`      |          | `DATA_DIR/servers`             | Host bind-mount source; auto-correct via the identity mount |
| `GAME_PORT_RANGE`       |          | `34197-34297`                  | Pre-forwarded UDP game-port pool |
| `RCON_PORT_RANGE`       |          | `27015-27115`                  | Loopback-only RCON port pool |
| `FACTORIO_IMAGE`        |          | `factoriotools/factorio:stable`| Base game server image; per-server tag overrides just the tag |
| `FACTORIO_NETWORK`      |          | `factorio-net`                 | Shared Docker network for manager↔RCON |
| `RCON_MODE`             |          | `network`                      | `network` (containerized) or `loopback` (local dev) |
| `PUID` / `PGID`         |          | `845`                          | UID/GID the Factorio image runs as |
| `STOP_SERVERS_ON_SHUTDOWN` |       | `false`                        | Stop all Factorio containers when the manager shuts down |
| `RESUME_SERVERS_ON_STARTUP` |      | `true`                         | On startup, resume servers that were running |

> **DNS / Cloudflare is not configured via env** — set the base domain, host record, Zone ID, API
> token, DDNS interval and IP-check URL in the dashboard (**DNS / Cloudflare settings**). They're
> stored in the database.

---

## Using it

- **Create a server:** name + subdomain (+ optional max players, description, map generation).
  Ports are allocated atomically and, if DNS is on, the SRV record is created.
- **Factorio.com account:** one global account (username + token), set on the Servers dashboard,
  used by **every** server for mod-portal downloads and the public server listing. There are no
  per-server credentials.
- **Server defaults (cascade):** a **Defaults** tab sets global defaults for auto-restart and backup
  config. These **cascade**: saving pushes the new value to every server that hasn't overridden it;
  a server that overrode a setting keeps its own value until you click **"Reset to global default"**
  on that field. New servers start out inheriting everything. Also sets a default **modpack** and
  **map template** applied to new servers at creation (changeable in the wizard).
- **Lifecycle:** start / stop / restart / delete. Delete removes the container, DNS record,
  releases the ports and deletes the data dir.
- **Console:** live RCON console + player list (over loopback / Docker network only).
- **Saves:** upload a `.zip`, list, create a new named save on demand (offline, via a one-shot
  container), pick which to load next, **restore** (load a save now — selects it and (re)starts),
  download, delete.
- **Backups:** on-demand ("manual") snapshots (kept under the server's `backups/` dir) plus
  **scheduled automatic backups** per server (toggle + interval, default every 15 min). Manual and
  auto backups have **separate keep-newest-N retention** — one never evicts the other, and a manual
  backup doesn't reset the auto schedule. Backing up a running server forces a fresh save via RCON
  first. Each backup can be downloaded, restored ("Restore from here" — into a save; server stopped),
  or deleted from the UI.
- **Map generation:** the in-game map-generation sliders — resource frequency/size/richness (iron,
  copper, coal, stone, uranium, oil), water, trees, enemy bases, cliffs, starting-area size,
  peaceful mode and map seed — available **in the create-server wizard** and on a per-server **Map
  gen** tab. Written to `config/map-gen-settings.json` only when you customize it, and applied to the
  **next new map generated** (first start with no save, or a new save from the Saves tab); doesn't
  alter an existing world. `map-settings.json` (pollution/evolution/expansion) is left to the image's
  version-matched example — Factorio validates it strictly against the exact binary version, so a
  hand-written one isn't safe.
- **Game modes:** each server is **Vanilla**, **Space Age**, **Space Age — without Quality**, or
  **Modded** (chosen in the create wizard, editable on the Map gen tab). The mode drives which
  map-gen sliders show — Vanilla is Nauvis-only; the Space Age modes show curated **per-planet**
  resource sliders (Nauvis, Vulcanus, Gleba, Fulgora, Aquilo) — and sets which bundled Space Age
  mods are enabled on next start (Vanilla disables all; "without Quality" keeps space-age +
  elevated-rails but disables the quality mod). Modded leans on a modpack + exchange-string import.
- **Map preview:** on the Map gen tab, a **Preview map** button renders a PNG of your current
  (unsaved) settings via a throwaway Factorio one-shot (`--generate-map-preview`, using the server's
  mods) — click the thumbnail to expand it full-res, or reroll the seed.
- **Map exchange strings:** paste a `>>>…<<<` string from Factorio's in-game map generator to
  **import** it — decoded to JSON by Factorio's own parser in a one-shot (needs the same version +
  mods), which populates the sliders and attaches version-correct map settings — or **export** the
  current settings as a shareable string on demand. An **Advanced** section edits the raw
  map-gen-settings JSON directly.
- **Map templates:** save a map-gen configuration as a named, reusable **template** (e.g. "all ores
  at 300%") and pick it when creating a server. A template is just a JSON manifest + DB record — no
  server link — that's **exportable/importable** for sharing. Managed under the **Templates** tab;
  a couple ("Rich resources", "Peaceful") are seeded by default. "Save as template" is available
  from any map-gen editor.
- **Server settings:** edit the full `server-settings.json` (visibility, game password, autosave,
  `allow_commands`, AFK kick, pause rules, …) via a structured form plus a raw-JSON escape hatch.
- **Auto-restart on change:** an optional per-server toggle — when on, saving a change that only
  takes effect at start (version/tag, server settings, mods, whitelist) automatically restarts the
  server in the background if it's running (only when a value actually changed); otherwise changes
  apply on the next manual start.
- **Whitelist & admin list:** per-server *and* **global** player whitelists and admin lists. Each
  effective list (global ∪ per-server) is written to `server-whitelist.json` / `server-adminlist.json`
  on start; an empty whitelist leaves the server open. Applies on next start/restart.
- **Per-server Factorio version:** each server picks its version from a dropdown — **stable**,
  **latest (experimental)**, or **custom** (any image tag, e.g. `2.0.55`) — overriding just the tag
  of the configured base repo (`FACTORIO_IMAGE`). The image is **pulled on every start/restart** to
  pick up updates to moving tags; if the registry is unreachable it falls back to the local copy.
- **Mods:** search the Factorio Mod Portal by keyword and add mods with one click; upload a mod
  `.zip` manually; enable/disable; update all to latest; delete all; export a shareable manifest.
  With the global Factorio.com account set, enabled mods are downloaded on save. Changes apply on
  next start.
- **Modpacks (shared registry):** build named, reusable mod collections once and **apply them to
  any server** (packs are manifests only — no binaries or credentials; mods are downloaded with the
  global Factorio.com account). Create a pack from scratch, snapshot one from a server, or
  **import/export** a pack as a JSON manifest to share it. Editing a pack doesn't auto-change
  servers; re-apply is explicit ("re-apply to all N servers using this pack"). A built-in
  **"Space Age"** modpack (`space-age` / `quality` / `elevated-rails`) is seeded on first run;
  those official expansion mods ship with the game data (they need the Space Age DLC) and are
  never downloaded from the portal — the manager just enables them in `mod-list.json`.

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

### Option 1 — Dev stack in containers (hot reload)

The easiest path — nothing to install on the host:

```bash
docker compose -f docker-compose.dev.yml up   # run from the repo root
```

Both services run from bind-mounted source with live reload (backend via `tsx watch`,
frontend via Vite HMR). The first `up` runs `npm install` into named volumes (slow once,
fast after). The backend drives the host Docker daemon and joins `factorio-net`, so RCON
works over the Docker network — same wiring as production. Open **http://localhost:5173**
(default login `dev`). Run it from the repo root so `HOST_SERVERS_DIR` resolves correctly.

### Option 2 — On the host (no containers)

```bash
# Backend (API on :8080). RCON_MODE=loopback so it reaches the published RCON ports.
# NB: the backend reads env vars directly — it does NOT load .env; pass them inline.
cd backend
npm install
ADMIN_PASSWORD=dev RCON_MODE=loopback DATA_DIR=$PWD/data npm run dev

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
| GET/PUT | `/servers/:id/settings` | full server-settings.json body |
| GET/PUT | `/servers/:id/mapgen` | this server's map-gen-settings (new-map generation) |
| GET/POST/PATCH/DELETE | `/mapgen-templates[...]` | map-gen template registry (list/create/edit/delete) |
| POST/GET | `/mapgen-templates/{import,from-server}` · `/:id/export` | import / snapshot / export a template |
| GET/PUT | `/servers/:id/{whitelist,adminlist}` · `/global/{whitelist,adminlist}` | per-server / global whitelist + admin list |
| GET/PUT | `/global/factorio` | the global Factorio.com account (mods + public listing) |
| GET/POST/DELETE | `/servers/:id/saves[...]` | list / upload / create / select / download / delete |
| GET/POST/DELETE | `/servers/:id/backups[...]` | list / create / download / restore / delete |
| GET/PUT | `/servers/:id/mods` | get / apply mod list |
| POST | `/servers/:id/mods/{upload,update,deleteAll}` · GET `/mods/export` | mod ops |
| GET | `/mods/search?q=` | search the mod portal catalog |
| GET/POST | `/modpacks` · `/modpacks/import` · `/modpacks/from-server` | list / create / import / snapshot |
| GET/PATCH/DELETE | `/modpacks/:id` | detail / update / delete |
| PUT/POST/GET | `/modpacks/:id/{mods,apply,apply-all,export}` | edit / apply / re-apply / export |
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
