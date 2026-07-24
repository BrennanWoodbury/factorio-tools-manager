import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IconCache } from '../src/services/iconCache.js';
import { IconSync, IconSyncJob, looksLikeInstall } from '../src/services/iconSync.js';
import { referencedPaths, buildIconManifest, resolveIconPath } from '../src/services/iconManifest.js';

const DATA_RAW = {
  item: { 'iron-plate': { icon: '__base__/graphics/icons/iron-plate.png' } },
  'transport-belt': { 'transport-belt': { icon: '__base__/graphics/icons/belt.png' } },
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ftm-sync-'));
}

/** A fake Factorio install rooted at `root`, reporting `version`. */
function fakeInstall(root: string, version: string): string {
  const m = buildIconManifest(DATA_RAW, { version });
  const dataDir = path.join(root, 'data');
  for (const p of referencedPaths(m)) {
    const full = resolveIconPath(p, dataDir);
    if (!full) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from('png'));
  }
  fs.mkdirSync(path.join(dataDir, 'base'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'base', 'info.json'), JSON.stringify({ name: 'base', version }));
  return root;
}

function harness(opts: { installVersion?: string; withDownload?: boolean } = {}) {
  const root = tmpDir();
  const cache = new IconCache(path.join(root, 'cache'));
  const install = opts.installVersion ? fakeInstall(path.join(root, 'install'), opts.installVersion) : undefined;
  const calls = { dump: 0, download: 0 };
  const logs: string[] = [];

  const sync = new IconSync({
    cache,
    resolveVersions: async () => [{ version: '2.0.77' }],
    localInstallDir: install,
    dumpDataRaw: async () => {
      calls.dump++;
      return DATA_RAW;
    },
    fetchInstall: opts.withDownload
      ? async (v: string) => {
          calls.download++;
          return path.join(fakeInstall(path.join(root, `dl-${v}`), v), 'data');
        }
      : undefined,
    log: (m) => logs.push(m),
  });

  return { root, cache, sync, calls, logs };
}

test('builds from a local install when the version matches exactly', async () => {
  const h = harness({ installVersion: '2.0.77' });
  const [out] = await h.sync.syncAll();
  assert.equal(out.source, 'local-install');
  assert.ok(out.copied && out.copied > 0);
  assert.equal(h.calls.download, 0, 'must not download when a matching install exists');
});

test('a second sync is a no-op — this is what makes a nightly job cheap', async () => {
  const h = harness({ installVersion: '2.0.77' });
  await h.sync.syncAll();
  const [out] = await h.sync.syncAll();
  assert.equal(out.source, 'cached');
  assert.equal(h.calls.dump, 1, 'no second prototype dump');
});

test('a mismatched local install is not used, and downloads when allowed', async () => {
  // Install is 2.1.12 but 2.0.77 is wanted: icon paths move between mods across
  // releases, so a near-miss would silently lose icons.
  const h = harness({ installVersion: '2.1.12', withDownload: true });
  const [out] = await h.sync.syncAll();
  assert.equal(out.source, 'download');
  assert.equal(h.calls.download, 1);
});

test('with no matching install and downloading disabled, it skips rather than failing', async () => {
  const h = harness({ installVersion: '2.1.12', withDownload: false });
  const [out] = await h.sync.syncAll();
  assert.equal(out.source, 'skipped');
  assert.match(out.reason ?? '', /downloading is disabled/);
});

test('a dump failure is reported, not thrown', async () => {
  const root = tmpDir();
  const sync = new IconSync({
    cache: new IconCache(path.join(root, 'cache')),
    resolveVersions: async () => [{ version: '2.0.77' }],
    dumpDataRaw: async () => {
      throw new Error('container exploded');
    },
    log: () => {},
  });
  const [out] = await sync.syncAll();
  assert.equal(out.source, 'failed');
  assert.match(out.reason ?? '', /container exploded/);
});

test('a download failure is reported, not thrown', async () => {
  const root = tmpDir();
  const sync = new IconSync({
    cache: new IconCache(path.join(root, 'cache')),
    resolveVersions: async () => [{ version: '2.0.77' }],
    dumpDataRaw: async () => DATA_RAW,
    fetchInstall: async () => {
      throw new Error('402 payment required');
    },
    log: () => {},
  });
  const [out] = await sync.syncAll();
  assert.equal(out.source, 'failed');
  assert.match(out.reason ?? '', /402/);
});

test('a failure to resolve versions never throws', async () => {
  const root = tmpDir();
  const sync = new IconSync({
    cache: new IconCache(path.join(root, 'cache')),
    resolveVersions: async () => {
      throw new Error('docker unreachable');
    },
    dumpDataRaw: async () => DATA_RAW,
    log: () => {},
  });
  assert.deepEqual(await sync.syncAll(), []);
});

test('multiple versions are all synced, and duplicates collapse', async () => {
  const root = tmpDir();
  const cache = new IconCache(path.join(root, 'cache'));
  fakeInstall(path.join(root, 'i1'), '2.0.77');
  let dumps = 0;
  const sync = new IconSync({
    cache,
    // Two servers on `stable`, one on `latest` — the per-server factorio_tag case.
    resolveVersions: async () => [{ version: '2.0.77' }, { version: '2.0.77' }, { version: '2.1.12' }],
    dumpDataRaw: async () => {
      dumps++;
      return DATA_RAW;
    },
    fetchInstall: async (v: string) => path.join(fakeInstall(path.join(root, `dl-${v}`), v), 'data'),
    log: () => {},
  });

  const outs = await sync.syncAll();
  assert.equal(outs.length, 2, 'the duplicate version is only handled once');
  assert.equal(dumps, 2);
  assert.equal(cache.list().length, 2, 'both versions cached side by side');
});

test('caches for versions no longer in use are pruned', async () => {
  const root = tmpDir();
  const cache = new IconCache(path.join(root, 'cache'));
  let wanted = [{ version: '2.0.77' }, { version: '2.1.12' }];
  const sync = new IconSync({
    cache,
    resolveVersions: async () => wanted,
    dumpDataRaw: async () => DATA_RAW,
    fetchInstall: async (v: string) => path.join(fakeInstall(path.join(root, `dl-${v}`), v), 'data'),
    log: () => {},
  });

  await sync.syncAll();
  assert.equal(cache.list().length, 2);

  wanted = [{ version: '2.1.12' }];
  await sync.syncAll();
  assert.equal(cache.list().length, 1, 'the retired version is dropped');
});

test('the job guards against overlapping runs', async () => {
  let active = 0;
  let maxActive = 0;
  const fake = {
    syncAll: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return [];
    },
  } as unknown as IconSync;

  const job = new IconSyncJob(fake);
  await Promise.all([job.runOnce(), job.runOnce(), job.runOnce()]);
  assert.equal(maxActive, 1, 'a slow build must not overlap the next tick');
  job.stop();
});

test('looksLikeInstall recognises a real layout only', () => {
  const root = tmpDir();
  assert.equal(looksLikeInstall(root), false);
  fakeInstall(root, '2.0.77');
  assert.equal(looksLikeInstall(root), true);
  assert.equal(looksLikeInstall(undefined), false);
});
