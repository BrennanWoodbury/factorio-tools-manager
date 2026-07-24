import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { openDb } from '../src/db/index.js';
import { BlueprintLibraryRepo } from '../src/db/blueprintLibraryRepo.js';
import { decode, flatten, hashPayload } from '../src/services/blueprintCodec.js';

function freshDb() {
  return openDb(':memory:');
}

let counter = 0;
function insertServer(db: ReturnType<typeof openDb>): string {
  const id = `srv-${++counter}`;
  db.prepare(
    `INSERT INTO servers (id, name, subdomain, game_port, rcon_port, rcon_password)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, id, `${id}-sub`, 34197 + counter, 27015 + counter, 'pw');
  return id;
}

function makeString(envelope: Record<string, unknown>): string {
  return '0' + zlib.deflateSync(Buffer.from(JSON.stringify(envelope), 'utf8')).toString('base64');
}

function bp(label: string | undefined, entities: string[]) {
  return {
    blueprint: {
      item: 'blueprint',
      ...(label === undefined ? {} : { label }),
      icons: [{ signal: { name: entities[0] ?? 'rail' }, index: 1 }],
      entities: entities.map((name, i) => ({ entity_number: i + 1, name, position: { x: i, y: 0 } })),
      version: 562954249175042,
    },
  };
}

function book(label: string, children: Record<string, unknown>[]) {
  return {
    blueprint_book: {
      item: 'blueprint-book',
      label,
      icons: [{ signal: { name: 'locomotive' }, index: 1 }],
      active_index: 0,
      blueprints: children.map((c, i) => ({ index: i, ...c })),
      version: 562954249175042,
    },
  };
}

test('ingests a bare blueprint as one blob and one sighting', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const s = insertServer(db);

  const r = repo.ingestString(makeString(bp('Solo', ['rail', 'rail'])), {
    serverId: s,
    saveName: 'default',
  });

  assert.equal(r.blobsInserted, 1);
  assert.equal(r.sightingsInserted, 1);
  const blob = repo.getBlob(r.rootHash);
  assert.ok(blob);
  assert.equal(blob.kind, 'blueprint');
  assert.equal(blob.label, 'Solo');
  assert.equal(blob.entity_total, 2);
  assert.equal(blob.game_version, '2.1.12.2');
});

test('re-ingesting an unchanged save inserts nothing new', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const s = insertServer(db);
  const str = makeString(book('Rails', [bp('A', ['rail']), bp('B', ['pipe'])]));

  const first = repo.ingestString(str, { serverId: s, saveName: 'default' });
  const second = repo.ingestString(str, { serverId: s, saveName: 'default' });

  assert.equal(first.blobsInserted, 3);
  assert.equal(first.sightingsInserted, 3);
  assert.equal(second.blobsInserted, 0, 'no duplicate blobs');
  assert.equal(second.sightingsInserted, 0, 'no duplicate sightings');
});

test('same blueprint in two servers is ONE blob with two sightings', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const a = insertServer(db);
  const b = insertServer(db);
  const str = makeString(bp('Shared', ['rail']));

  const r1 = repo.ingestString(str, { serverId: a, saveName: 'default' });
  const r2 = repo.ingestString(str, { serverId: b, saveName: 'default' });

  assert.equal(r1.rootHash, r2.rootHash, 'identical content is the same blob');
  assert.equal(r2.blobsInserted, 0);
  assert.equal(r2.sightingsInserted, 1);
  assert.equal(repo.sightings(r1.rootHash).length, 2);
});

test('otherSightingCount powers "also in N other saves"', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const a = insertServer(db);
  const b = insertServer(db);
  const c = insertServer(db);
  const str = makeString(bp('Everywhere', ['rail']));
  for (const s of [a, b, c]) repo.ingestString(str, { serverId: s, saveName: 'default' });

  const hash = hashPayload(decode(str));
  assert.equal(repo.otherSightingCount(hash, a), 2);
  assert.equal(repo.otherSightingCount(hash, b), 2);
});

test('the same save name on two servers stays two distinct sightings', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const a = insertServer(db);
  const b = insertServer(db);
  const str = makeString(bp('Dup', ['rail']));
  repo.ingestString(str, { serverId: a, saveName: 'default' });
  repo.ingestString(str, { serverId: b, saveName: 'default' });
  assert.equal(repo.sightings(hashPayload(decode(str))).length, 2);
});

test('a book stores its ordered children', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const s = insertServer(db);
  const entries = flatten(decode(makeString(book('Bk', [bp('A', ['rail']), bp('B', ['pipe'])]))));
  const r = repo.ingest(entries, { serverId: s, saveName: 'default' });

  const children = repo.childHashes(r.rootHash);
  assert.equal(children.length, 2);
  assert.deepEqual(children, [entries[0].hash, entries[1].hash]);
  assert.equal(repo.getBlob(children[0])?.label, 'A');
});

test('editing one blueprint in a book writes only the changed blob', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const s = insertServer(db);

  repo.ingestString(makeString(book('Bk', [bp('A', ['rail']), bp('B', ['pipe'])])), {
    serverId: s,
    saveName: 'default',
  });
  // One child edited: expect a new child blob + a new book manifest, nothing else.
  const after = repo.ingestString(
    makeString(book('Bk', [bp('A', ['rail']), bp('B', ['pipe', 'pump'])])),
    { serverId: s, saveName: 'default' },
  );

  assert.equal(after.blobsInserted, 2, 'edited child + new book manifest only');
});

test('blueprints inside a book are individually findable', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const s = insertServer(db);
  repo.ingestString(makeString(book('Bk', [bp('Buried', ['rail'])])), {
    serverId: s,
    saveName: 'default',
  });

  const found = repo.listByServer(s).filter((b) => b.label === 'Buried');
  assert.equal(found.length, 1, 'a blueprint that only exists inside a book is still listed');
});

test('deleting a server keeps the blueprint and orphans the sighting', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const s = insertServer(db);
  const r = repo.ingestString(makeString(bp('Survivor', ['rail'])), {
    serverId: s,
    saveName: 'default',
    collection: 'Old Server',
  });

  db.prepare('DELETE FROM servers WHERE id = ?').run(s);

  assert.ok(repo.getBlob(r.rootHash), 'blob outlives the server');
  const sightings = repo.sightings(r.rootHash);
  assert.equal(sightings.length, 1);
  assert.equal(sightings[0].server_id, null, 'ON DELETE SET NULL orphans rather than cascades');
  assert.equal(sightings[0].collection, 'Old Server', 'collection label survives for grouping');
  assert.equal(repo.listOrphaned().length, 1);
});

test('stringFor returns a re-encodable string that decodes to the same content', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const s = insertServer(db);
  const r = repo.ingestString(makeString(bp('Export', ['rail', 'pipe'])), {
    serverId: s,
    saveName: 'default',
  });

  const out = repo.stringFor(r.rootHash);
  assert.ok(out);
  assert.equal(hashPayload(decode(out)), r.rootHash);
});

test('uploads with no server are supported and land in the orphaned shelf', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  const r = repo.ingestString(makeString(bp('FromDisk', ['rail'])), {
    serverId: null,
    saveName: 'my-old-game.zip',
    collection: 'Single Player 2021',
    source: 'upload',
  });

  const sightings = repo.sightings(r.rootHash);
  assert.equal(sightings[0].source, 'upload');
  assert.equal(sightings[0].collection, 'Single Player 2021');
  assert.equal(repo.listOrphaned().length, 1);
});

test('a failed ingest leaves no partial rows', () => {
  const db = freshDb();
  const repo = new BlueprintLibraryRepo(db);
  assert.throws(() => repo.ingestString('not a blueprint'));
  assert.equal(db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM blueprint_blobs').get()?.n, 0);
});
