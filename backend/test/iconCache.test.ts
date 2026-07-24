import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildIconManifest,
  cacheKeyFor,
  modOfPath,
  referencedPaths,
  resolveIconPath,
  splitIconPath,
} from '../src/services/iconManifest.js';
import { IconCache } from '../src/services/iconCache.js';
import {
  downloadUrl,
  installMods,
  installVersion,
  localInstallMatches,
  redactedDownloadUrl,
} from '../src/services/factorioAssets.js';
import { ValidationError } from '../src/lib/errors.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ftm-icons-'));
}

/** A miniature data.raw with the shapes that matter: single icon, layers, junk. */
const DATA_RAW = {
  item: {
    'iron-plate': { icon: '__base__/graphics/icons/iron-plate.png', icon_size: 64 },
    'water-barrel': {
      icons: [
        { icon: '__base__/graphics/icons/empty-barrel.png', icon_size: 64 },
        { icon: '__base__/graphics/icons/fluid.png', tint: { r: 0.2, g: 0.5, b: 1, a: 0.8 }, scale: 0.5 },
      ],
    },
    'no-icon-item': { stack_size: 50 },
  },
  'transport-belt': {
    'turbo-transport-belt': { icon: '__space-age__/graphics/icons/turbo-transport-belt.png' },
  },
  'straight-rail': {
    // The case that forces us to read the dump instead of guessing filenames.
    'straight-rail': { icon: '__base__/graphics/icons/rail.png' },
  },
  'virtual-signal': {
    'shape-cross': { icon: '__base__/graphics/icons/shapes/shape-cross.png' },
  },
  // Bulk categories that must be excluded.
  recipe: { 'iron-gear': { icon: '__base__/graphics/icons/gear.png' } },
  technology: { logistics: { icon: '__base__/graphics/technology/logistics.png' } },
  explosion: { boom: { icon: '__base__/graphics/icons/boom.png' } },
};

/** Lay out a fake install containing every PNG the manifest references. */
function fakeInstall(root: string, manifestPaths: string[], skip: string[] = []): string {
  const dataDir = path.join(root, 'data');
  for (const p of manifestPaths) {
    if (skip.includes(p)) continue;
    const full = resolveIconPath(p, dataDir);
    if (!full) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(`png:${p}`));
  }
  const baseDir = path.join(dataDir, 'base');
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'info.json'), JSON.stringify({ name: 'base', version: '2.0.77' }));
  return dataDir;
}

test('manifest keeps blueprint-relevant categories and drops bulk ones', () => {
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  assert.ok(m.icons['iron-plate']);
  assert.ok(m.icons['turbo-transport-belt']);
  assert.ok(m.icons['shape-cross']);
  assert.equal(m.icons['iron-gear'], undefined, 'recipes excluded');
  assert.equal(m.icons['logistics'], undefined, 'technologies excluded');
  assert.equal(m.icons['boom'], undefined, 'explosions excluded');
  assert.equal(m.icons['no-icon-item'], undefined, 'prototypes without icons skipped');
});

test('icon filenames need not match prototype names', () => {
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  assert.equal(m.icons['straight-rail'].layers[0].path, '__base__/graphics/icons/rail.png');
});

test('layered icons keep every layer with tint and scale', () => {
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  const layers = m.icons['water-barrel'].layers;
  assert.equal(layers.length, 2);
  assert.equal(layers[0].path, '__base__/graphics/icons/empty-barrel.png');
  assert.equal(layers[1].tint?.b, 1);
  assert.equal(layers[1].scale, 0.5);
});

test('mods are discovered from icon paths', () => {
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  assert.ok(m.mods.includes('base'));
  assert.ok(m.mods.includes('space-age'));
});

test('splitIconPath rejects traversal and non-PNG paths', () => {
  assert.deepEqual(splitIconPath('__base__/graphics/icons/rail.png'), {
    mod: 'base',
    rest: 'graphics/icons/rail.png',
  });
  for (const bad of [
    '__base__/../../etc/passwd.png',
    '__base__/graphics/notes.txt',
    'relative/path.png',
    '__base__//abs.png'.replace('//', '/../'),
    '',
  ]) {
    assert.equal(splitIconPath(bad), undefined, `should reject ${JSON.stringify(bad)}`);
  }
});

test('modOfPath extracts hyphenated mod names', () => {
  assert.equal(modOfPath('__space-age__/graphics/icons/x.png'), 'space-age');
  assert.equal(modOfPath('nope.png'), undefined);
});

test('cacheKeyFor collapses vanilla to the version and is stable for mod sets', () => {
  assert.equal(cacheKeyFor('2.0.77', ['base', 'core']), '2.0.77');
  const a = cacheKeyFor('2.0.77', ['base', 'space-age', 'quality']);
  const b = cacheKeyFor('2.0.77', ['quality', 'space-age', 'base']);
  assert.equal(a, b, 'mod order must not change the key');
  assert.notEqual(a, '2.0.77');
});

test('build copies referenced icons and writes a manifest', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  const dataDir = fakeInstall(root, referencedPaths(m));
  const cache = new IconCache(path.join(root, 'cache'));

  const res = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.0.77' });

  assert.equal(res.missing.length, 0);
  assert.ok(res.copied > 0);
  assert.ok(cache.has(res.key));
  assert.equal(cache.manifest(res.key).version, '2.0.77');

  const icon = cache.iconFileFor(res.key, 'straight-rail');
  assert.ok(icon, 'straight-rail resolves to a file');
  assert.match(fs.readFileSync(icon, 'utf8'), /rail\.png$/);
});

test('an icon shared by several prototypes is stored once', () => {
  const root = tmpDir();
  const shared = {
    item: { 'rail-a': { icon: '__base__/graphics/icons/rail.png' } },
    'straight-rail': { 'straight-rail': { icon: '__base__/graphics/icons/rail.png' } },
    'curved-rail': { 'curved-rail': { icon: '__base__/graphics/icons/rail.png' } },
  };
  const m = buildIconManifest(shared, { version: '1.0.0' });
  const dataDir = fakeInstall(root, referencedPaths(m));
  const cache = new IconCache(path.join(root, 'cache'));
  const res = cache.build({ dataRaw: shared, dataDir, version: '1.0.0' });

  assert.equal(res.copied, 1, 'three prototypes, one file on disk');
  assert.equal(Object.keys(cache.manifest(res.key).icons).length, 3);
});

test('missing source files are reported, not fatal', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  const all = referencedPaths(m);
  const dataDir = fakeInstall(root, all, [all[0]]);
  const cache = new IconCache(path.join(root, 'cache'));

  const res = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.0.77' });
  assert.equal(res.missing.length, 1, 'the absent icon is recorded');
  assert.ok(cache.has(res.key), 'cache still becomes usable');
});

test('a failed build leaves no visible cache and no temp dirs', () => {
  const root = tmpDir();
  const cache = new IconCache(path.join(root, 'cache'));
  assert.throws(
    () => cache.build({ dataRaw: DATA_RAW, dataDir: path.join(root, 'nope'), version: '2.0.77' }),
    ValidationError,
  );
  assert.equal(cache.list().length, 0);
});

test('rebuild replaces atomically and keeps the old cache until done', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  const dataDir = fakeInstall(root, referencedPaths(m));
  const cache = new IconCache(path.join(root, 'cache'));

  const first = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.0.77' });
  const second = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.0.77' });

  assert.equal(first.key, second.key);
  assert.equal(cache.list().length, 1, 'no duplicate or leftover directory');
  assert.equal(cache.cleanTemp(), 0, 'no temp dirs left behind');
});

test('several versions coexist, because servers can pin different tags', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  const dataDir = fakeInstall(root, referencedPaths(m));
  const cache = new IconCache(path.join(root, 'cache'));

  const older = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.0.77' });
  const newer = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.1.12' });

  assert.notEqual(older.key, newer.key);
  assert.deepEqual(cache.list().sort(), [older.key, newer.key].sort());
  assert.ok(cache.iconFileFor(older.key, 'iron-plate'));
  assert.ok(cache.iconFileFor(newer.key, 'iron-plate'));
});

test('prune removes unreferenced caches but never the last one', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  const dataDir = fakeInstall(root, referencedPaths(m));
  const cache = new IconCache(path.join(root, 'cache'));
  const older = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.0.77' });
  const newer = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.1.12' });

  assert.deepEqual(cache.prune(new Set([newer.key])), [older.key]);
  assert.deepEqual(cache.list(), [newer.key]);

  // Nothing referenced at all: keep the newest rather than leaving no icons.
  assert.deepEqual(cache.prune(new Set()), []);
  assert.equal(cache.list().length, 1);
});

test('a mod set changes the cache key, so modded servers get their own icons', () => {
  const vanilla = { item: { 'iron-plate': { icon: '__base__/graphics/icons/iron-plate.png' } } };
  const modded = {
    item: {
      'iron-plate': { icon: '__base__/graphics/icons/iron-plate.png' },
      'turbo-belt': { icon: '__space-age__/graphics/icons/turbo.png' },
    },
  };
  const a = buildIconManifest(vanilla, { version: '2.0.77' });
  const b = buildIconManifest(modded, { version: '2.0.77' });
  assert.equal(cacheKeyFor(a.version, a.mods), '2.0.77');
  assert.notEqual(cacheKeyFor(b.version, b.mods), '2.0.77');
});

test('unknown prototypes and missing caches degrade to undefined, never throw', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  const dataDir = fakeInstall(root, referencedPaths(m));
  const cache = new IconCache(path.join(root, 'cache'));
  const res = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.0.77' });

  assert.equal(cache.iconFileFor(res.key, 'does-not-exist'), undefined);
  assert.equal(cache.iconFileFor('no-such-version', 'iron-plate'), undefined);
  assert.equal(cache.iconFileFor(res.key, 'iron-plate', 9), undefined);
});

test('status reports what a cache actually holds', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  const dataDir = fakeInstall(root, referencedPaths(m));
  const cache = new IconCache(path.join(root, 'cache'));
  const res = cache.build({ dataRaw: DATA_RAW, dataDir, version: '2.0.77' });

  const s = cache.status(res.key);
  assert.ok(s);
  assert.equal(s.version, '2.0.77');
  assert.equal(s.iconCount, Object.keys(m.icons).length);
  assert.ok(s.bytes > 0);
  assert.equal(cache.status('nope'), undefined);
});

test('install version and mods are read from disk', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  fakeInstall(root, referencedPaths(m));
  assert.equal(installVersion(root), '2.0.77');
  assert.deepEqual(installMods(root), ['base']);
  assert.equal(installVersion(path.join(root, 'missing')), undefined);
});

test('a local install is only used on an exact version match', () => {
  const root = tmpDir();
  const m = buildIconManifest(DATA_RAW, { version: '2.0.77' });
  fakeInstall(root, referencedPaths(m));
  assert.equal(localInstallMatches(root, '2.0.77'), true);
  // Icon paths move between mods across releases, so near-misses are not usable.
  assert.equal(localInstallMatches(root, '2.1.12'), false);
  assert.equal(localInstallMatches(undefined, '2.0.77'), false);
});

test('download URL requests the expansion build and never leaks the token in logs', () => {
  const account = { username: 'woody', token: 'secret-token' };
  const url = downloadUrl('2.0.77', 'expansion', account);
  // `alpha` would silently omit every Space Age icon.
  assert.match(url, /\/2\.0\.77\/expansion\/linux64/);
  assert.match(url, /username=woody/);
  assert.match(url, /token=secret-token/);
  assert.doesNotMatch(redactedDownloadUrl('2.0.77', 'expansion'), /secret-token/);
});
