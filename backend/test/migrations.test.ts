import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DB, openDb } from '../src/db/index.js';
import { SCHEMA_SQL } from '../src/db/schema.js';
import {
  runMigrations,
  schemaVersion,
  LATEST_SCHEMA_VERSION,
  SchemaTooNewError,
} from '../src/db/migrations.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ftm-mig-'));
}

test('a fresh database ends up at the latest schema version', () => {
  const dir = tmpDir();
  try {
    const db = openDb(path.join(dir, 'manager.db'));
    assert.equal(schemaVersion(db), LATEST_SCHEMA_VERSION);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a database from a newer release is refused rather than half-understood', () => {
  const db = new DB(':memory:');
  db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
  assert.throws(
    () => runMigrations(db),
    (err: unknown) => {
      assert.ok(err instanceof SchemaTooNewError);
      // The message has to tell an operator what to actually do about it.
      assert.match(err.message, new RegExp(`v${LATEST_SCHEMA_VERSION + 1}`));
      assert.match(err.message, /Roll forward/i);
      assert.match(err.message, /db-backups/);
      return true;
    },
  );
  db.close();
});

test('an up-to-date database migrates nothing and takes no snapshot', () => {
  const db = new DB(':memory:');
  db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`);
  let called = false;
  runMigrations(db, { onBeforeMigrate: () => (called = true) });
  assert.equal(called, false, 'should not snapshot when there is nothing to migrate');
  db.close();
});

test('the pre-migration hook fires once, before anything is applied', () => {
  const db = new DB(':memory:');
  db.exec(SCHEMA_SQL);
  const seen: number[] = [];
  runMigrations(db, {
    onBeforeMigrate: (from) => {
      seen.push(from);
      // The snapshot must be taken while the schema is still the old one.
      assert.equal(schemaVersion(db), 0);
    },
  });
  assert.deepEqual(seen, [0]);
  assert.equal(schemaVersion(db), LATEST_SCHEMA_VERSION);
  db.close();
});

test('opening an existing database snapshots it before upgrading', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'manager.db');
  try {
    // A database as an older build would have left it: the base schema, stamped
    // with the version that build had reached. Reusing a fully-migrated database
    // and rewinding user_version would not be the same thing — the columns later
    // migrations add would already be there.
    const old = new DB(file);
    old.exec(SCHEMA_SQL);
    old.exec('PRAGMA user_version = 2');
    old.close();

    const db = openDb(file);
    assert.equal(schemaVersion(db), LATEST_SCHEMA_VERSION);
    db.close();

    const snapshots = fs.readdirSync(path.join(dir, 'db-backups'));
    assert.equal(snapshots.length, 1);
    assert.match(snapshots[0], /^manager-v2-.*\.db$/);
    // A real, openable database — not a zero-byte file.
    const restored = new DB(path.join(dir, 'db-backups', snapshots[0]));
    assert.equal(schemaVersion(restored), 2);
    restored.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a first run and a no-op open both leave no snapshot behind', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'manager.db');
  try {
    openDb(file).close(); // brand new: migrates from 0, but there is nothing to save
    openDb(file).close(); // already current: nothing to migrate at all
    assert.equal(fs.existsSync(path.join(dir, 'db-backups')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
