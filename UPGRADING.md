# Upgrading, rolling back, and what counts as a breaking change

## How releases reach you

Releases are cut deliberately, by tagging. Merging to `main` does **not** reach users:

| Tag on Docker Hub | Moves when | Use it if |
| --- | --- | --- |
| `latest` | a version is released | you want releases as they land (the Unraid template tracks this) |
| `1`, `1.4` | a release in that line | you want fixes but not the next major/minor |
| `1.4.2` | never | you want an exact, reproducible build |
| `edge` | every push to `main` | you're testing unreleased work and accept breakage |

`edge` is not supported for real servers. It has had no release testing and may contain
migrations that are still being iterated on.

## Upgrading

Pull the new image and recreate the container — on Unraid, that's the normal update
button. Your Factorio servers keep running while the manager restarts; they aren't
touched unless `STOP_SERVERS_ON_SHUTDOWN=true`.

**The database migrates itself on first start, and snapshots itself first.** Before
applying any migration, the manager writes a consistent copy to
`<data>/db-backups/manager-v<schema>-<timestamp>.db` and keeps the five most recent. If
the snapshot can't be written it refuses to migrate rather than proceeding unprotected
(override with `SKIP_DB_BACKUP=true`, accepting that the upgrade won't be reversible).

Read the [release notes](CHANGELOG.md) before a **major** version. Those are the only
releases allowed to require anything of you, and the steps will be written there.

## Rolling back

Set the image tag to the version you want — on Unraid, edit the container's Repository
field to e.g. `brennanwoodbury/factorio-manager:1.4.2` and apply.

**If the newer version applied a migration, restore its snapshot too.** Migrations only
run forward, so an older build cannot read a newer schema. It will tell you so and
refuse to start rather than operate on a schema it doesn't understand:

```
This database is at schema v18, but this version of the manager only understands up to
v14. It was last opened by a newer release.
```

To go back:

1. Stop the manager.
2. In `<data>/db-backups/`, find the newest snapshot whose `v<number>` is one the older
   build understands, and copy it over `<data>/manager.db`.
3. Remove the stale `manager.db-wal` and `manager.db-shm` files if present.
4. Start the older image.

Anything recorded after the upgrade is not in that snapshot. Servers, saves, mods and
backups all live on disk rather than in the database, so they survive regardless — it's
the manager's own records (server list, settings, modpacks, templates) that revert.

## What counts as a breaking change

These are treated as a public contract. Changing any of them incompatibly requires a
**major** version and a documented path in the release notes:

- **Environment variable names and meanings** — the Unraid template and everyone's
  compose file are written against them. Renamed variables keep the old name working
  for at least one major, with a startup warning.
- **The Unraid template's `Config` targets** — an existing install's settings are keyed
  by these; changing one silently drops a user's value.
- **The data directory layout** — `manager.db`, `servers/<id>/{saves,mods,config}`.
- **Default ports and port-range behaviour** — people have forwarded these on a router.
- **Anything requiring manual action after an update.**

Deliberately *not* covered: the HTTP API. The SPA ships in the same image as the backend
it talks to, so the two are always in step and the API is internal.

Migrations are additive wherever possible. A migration that destroys data is a major
version on its own, and the release notes say so explicitly.
