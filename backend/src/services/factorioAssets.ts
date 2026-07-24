import fs from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../lib/errors.js';
import type { FactorioAccount } from './factorioAccount.js';

/**
 * Locating a Factorio *install* (the thing that has graphics), as opposed to the
 * headless container (which has none).
 *
 * Two sources, tried in cost order:
 *
 *  1. A local install directory, if one is configured and matches the wanted
 *     version. Free — a 14 MB copy out of a 4.6 GB tree.
 *  2. The official Download API, using the same factorio.com username/token the
 *     manager already stores for mod downloads. Multi-GB, so it only ever runs
 *     when a version genuinely has no cache.
 *
 * Nothing is redistributed with this project: assets are pulled from a copy the
 * user already owns, which is exactly how FBSR and factorio-blueprint-editor do
 * it (both gitignore their generated assets).
 */

const DOWNLOAD_BASE = 'https://www.factorio.com/get-download';
const RELEASES_URL = 'https://factorio.com/api/latest-releases';

/**
 * Build variant to request.
 *
 * `expansion` is the full game *including* Space Age; `alpha` is the full game
 * WITHOUT it. Requesting `alpha` silently loses every Space Age icon, so
 * `expansion` is the default here — a real trap, since the reference
 * implementation in factorio-blueprint-editor hardcodes `alpha`.
 */
export type FactorioBuild = 'expansion' | 'alpha' | 'demo';

export interface LatestReleases {
  stable: Record<string, string>;
  experimental: Record<string, string>;
}

/** Read `data/base/info.json` to learn an install's version. */
export function installVersion(installDir: string): string | undefined {
  const infoPath = path.join(installDir, 'data', 'base', 'info.json');
  try {
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8')) as { version?: unknown };
    return typeof info.version === 'string' ? info.version : undefined;
  } catch {
    return undefined;
  }
}

/** Mod directories present in an install's `data` dir (`base`, `space-age`, …). */
export function installMods(installDir: string): string[] {
  const dataDir = path.join(installDir, 'data');
  if (!fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dataDir, d.name, 'info.json')))
    .map((d) => d.name)
    .sort();
}

/**
 * Whether a local install can serve a given version.
 *
 * Deliberately an exact match. Icon paths move between mods across releases — in
 * 2.0.77 the recycler icon lives under `__quality__` and by 2.1.12 it has moved to
 * its own mod — so resolving one version's dump against another's files silently
 * yields missing icons.
 */
export function localInstallMatches(installDir: string | undefined, version: string): boolean {
  if (!installDir || installDir === '') return false;
  return installVersion(installDir) === version;
}

/** Current stable/experimental versions per build, from factorio.com. */
export async function fetchLatestReleases(fetchImpl: typeof fetch = fetch): Promise<LatestReleases> {
  const res = await fetchImpl(RELEASES_URL);
  if (!res.ok) throw new ValidationError(`Could not read Factorio releases (HTTP ${res.status})`);
  return (await res.json()) as LatestReleases;
}

/** The download URL for a build. Credentials go in the query string, as the API requires. */
export function downloadUrl(
  version: string,
  build: FactorioBuild,
  account: FactorioAccount,
  distro = 'linux64',
): string {
  const u = new URL(`${DOWNLOAD_BASE}/${encodeURIComponent(version)}/${build}/${distro}`);
  u.searchParams.set('username', account.username);
  u.searchParams.set('token', account.token);
  return u.toString();
}

/** Same URL with the token redacted — safe to log or show in the UI. */
export function redactedDownloadUrl(
  version: string,
  build: FactorioBuild,
  distro = 'linux64',
): string {
  return `${DOWNLOAD_BASE}/${version}/${build}/${distro}?username=***&token=***`;
}

/**
 * Download a Factorio build to `destFile`.
 *
 * Streamed to disk rather than buffered: these archives are multiple gigabytes and
 * must not be held in memory. Callers are expected to have checked that the
 * version is actually missing before calling — this is the expensive path.
 */
export async function downloadFactorio(
  opts: {
    version: string;
    build?: FactorioBuild;
    distro?: string;
    account: FactorioAccount;
    destFile: string;
    onProgress?: (received: number, total?: number) => void;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: number; path: string }> {
  if (!opts.account.username || !opts.account.token) {
    throw new ValidationError(
      'A factorio.com username and token are required to download game assets (Settings → Factorio account)',
    );
  }

  const url = downloadUrl(opts.version, opts.build ?? 'expansion', opts.account, opts.distro);
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (res.status === 403 || res.status === 401) {
    throw new ValidationError('factorio.com rejected the credentials (check username/token)');
  }
  if (res.status === 404) {
    throw new ValidationError(
      `Factorio ${opts.version} is not downloadable — experimental builds are removed once superseded`,
    );
  }
  if (!res.ok || !res.body) {
    throw new ValidationError(`Factorio download failed (HTTP ${res.status})`);
  }

  const total = Number(res.headers.get('content-length')) || undefined;
  fs.mkdirSync(path.dirname(opts.destFile), { recursive: true });
  const out = fs.createWriteStream(opts.destFile);

  let received = 0;
  try {
    // Node's fetch body is an async-iterable web stream.
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk as Uint8Array);
      received += buf.length;
      if (!out.write(buf)) {
        await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      }
      opts.onProgress?.(received, total);
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });
  } catch (err) {
    out.destroy();
    fs.rmSync(opts.destFile, { force: true });
    throw err;
  }

  return { bytes: received, path: opts.destFile };
}
