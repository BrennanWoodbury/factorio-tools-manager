import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { PortAllocator } from '../src/services/portAllocator.js';
import { PortPoolExhaustedError } from '../src/lib/errors.js';

/** In-memory DB with the real schema. */
function freshDb() {
  return openDb(':memory:');
}

let counter = 0;
function insertServer(db: ReturnType<typeof openDb>, gamePort = 0, rconPort = 0): string {
  const id = `srv-${++counter}`;
  db.prepare(
    `INSERT INTO servers (id, name, subdomain, game_port, rcon_port, rcon_password)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, id, `${id}-sub`, gamePort, rconPort, 'pw');
  return id;
}

test('allocates lowest free ports from each range', () => {
  const db = freshDb();
  const alloc = new PortAllocator(db, [34197, 34199], [27015, 27017]);
  const s = insertServer(db);
  const { gamePort, rconPort } = alloc.allocatePair(s);
  assert.equal(gamePort, 34197);
  assert.equal(rconPort, 27015);
});

test('never double-allocates a port across many servers', () => {
  const db = freshDb();
  const alloc = new PortAllocator(db, [34197, 34206], [27015, 27024]);
  const game = new Set<number>();
  const rcon = new Set<number>();
  for (let i = 0; i < 10; i++) {
    const s = insertServer(db);
    const { gamePort, rconPort } = alloc.allocatePair(s);
    assert.ok(!game.has(gamePort), `game port ${gamePort} handed out twice`);
    assert.ok(!rcon.has(rconPort), `rcon port ${rconPort} handed out twice`);
    game.add(gamePort);
    rcon.add(rconPort);
  }
  assert.equal(game.size, 10);
  assert.equal(rcon.size, 10);
});

test('reuses ports after release', () => {
  const db = freshDb();
  const alloc = new PortAllocator(db, [34197, 34197], [27015, 27015]); // range of 1 each
  const s1 = insertServer(db);
  const a = alloc.allocatePair(s1);
  assert.equal(a.gamePort, 34197);
  // pool now full
  const s2 = insertServer(db);
  assert.throws(() => alloc.allocatePair(s2), PortPoolExhaustedError);
  // release s1, pool free again
  alloc.releaseServerPorts(s1);
  const s3 = insertServer(db);
  const b = alloc.allocatePair(s3);
  assert.equal(b.gamePort, 34197);
});

test('rolls back game claim when rcon range is exhausted', () => {
  const db = freshDb();
  // game range has room, rcon range is size 1 and gets used up first
  const alloc = new PortAllocator(db, [34197, 34206], [27015, 27015]);
  const s1 = insertServer(db);
  alloc.allocatePair(s1); // consumes the single rcon port
  const s2 = insertServer(db);
  assert.throws(() => alloc.allocatePair(s2), PortPoolExhaustedError);
  // The game port that would have gone to s2 must NOT have been claimed:
  // capacity used for game must still be 1, not 2.
  assert.equal(alloc.capacity('game').used, 1);
  assert.equal(alloc.capacity('rcon').used, 1);
});

test('capacity reports total/used/free correctly', () => {
  const db = freshDb();
  const alloc = new PortAllocator(db, [34197, 34199], [27015, 27017]); // 3 each
  assert.deepEqual(alloc.capacity('game'), { total: 3, used: 0, free: 3 });
  const s = insertServer(db);
  alloc.allocatePair(s);
  assert.deepEqual(alloc.capacity('game'), { total: 3, used: 1, free: 2 });
  assert.deepEqual(alloc.capacity('rcon'), { total: 3, used: 1, free: 2 });
});
