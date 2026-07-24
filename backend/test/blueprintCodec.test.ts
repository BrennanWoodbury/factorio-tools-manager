import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  canonicalize,
  decode,
  encode,
  flatten,
  formatGameVersion,
  hashPayload,
  kindOf,
  looksLikeBlueprintString,
  verifyRoundTrip,
} from '../src/services/blueprintCodec.js';
import { ValidationError } from '../src/lib/errors.js';

/** Build a blueprint string the way Factorio does, for fixtures. */
function makeString(envelope: Record<string, unknown>): string {
  return '0' + zlib.deflateSync(Buffer.from(JSON.stringify(envelope), 'utf8')).toString('base64');
}

function bp(label: string | undefined, entities: string[], extra: Record<string, unknown> = {}) {
  return {
    blueprint: {
      item: 'blueprint',
      ...(label === undefined ? {} : { label }),
      icons: [{ signal: { name: entities[0] ?? 'transport-belt' }, index: 1 }],
      entities: entities.map((name, i) => ({ entity_number: i + 1, name, position: { x: i, y: 0 } })),
      version: 562954249175042,
      ...extra,
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

test('decodes a well-formed blueprint string', () => {
  const env = decode(makeString(bp('Test', ['transport-belt', 'inserter'])));
  assert.equal(kindOf(env), 'blueprint');
  const body = env.blueprint as { label: string; entities: unknown[] };
  assert.equal(body.label, 'Test');
  assert.equal(body.entities.length, 2);
});

test('round-trips encode -> decode without changing identity', () => {
  const env = decode(makeString(bp('RT', ['fast-inserter'])));
  assert.equal(hashPayload(decode(encode(env))), hashPayload(env));
});

test('tolerates whitespace and newlines inside the string', () => {
  const s = makeString(bp('WS', ['pipe']));
  const wrapped = s.slice(0, 20) + '\n  ' + s.slice(20);
  assert.equal(hashPayload(decode(wrapped)), hashPayload(decode(s)));
});

test('rejects malformed input with ValidationError, not a generic throw', () => {
  const bad: [string, string][] = [
    ['', 'empty'],
    ['1abcdef', 'wrong version byte'],
    ['0!!!!not-base64!!!!', 'non-base64'],
    ['0' + Buffer.from('not zlib at all').toString('base64'), 'not zlib'],
    ['0' + zlib.deflateSync(Buffer.from('{"nope":1}')).toString('base64'), 'unknown kind'],
    ['0' + zlib.deflateSync(Buffer.from('[1,2,3]')).toString('base64'), 'not an object'],
  ];
  for (const [input, why] of bad) {
    assert.throws(() => decode(input), ValidationError, `expected ValidationError for ${why}`);
  }
});

test('canonicalisation makes key order irrelevant to identity', () => {
  const a = { blueprint: { item: 'blueprint', label: 'X', version: 1 } };
  const b = { blueprint: { version: 1, label: 'X', item: 'blueprint' } };
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
  assert.equal(hashPayload(a), hashPayload(b));
});

test('canonicalisation preserves array order (entity order is meaningful)', () => {
  const a = canonicalize({ e: [{ n: 1 }, { n: 2 }] }) as { e: { n: number }[] };
  assert.deepEqual(
    a.e.map((x) => x.n),
    [1, 2],
  );
  assert.notEqual(hashPayload({ e: [1, 2] }), hashPayload({ e: [2, 1] }));
});

test('identity survives re-compression at a different zlib level', () => {
  const env = bp('Recompress', ['steel-chest']);
  const low = '0' + zlib.deflateSync(Buffer.from(JSON.stringify(env)), { level: 1 }).toString('base64');
  const high = '0' + zlib.deflateSync(Buffer.from(JSON.stringify(env)), { level: 9 }).toString('base64');
  assert.notEqual(low, high, 'fixture should differ at the byte level');
  assert.equal(hashPayload(decode(low)), hashPayload(decode(high)));
});

test('flatten yields a single entry for a bare blueprint', () => {
  const entries = flatten(decode(makeString(bp('Solo', ['inserter', 'inserter']))));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'blueprint');
  assert.equal(entries[0].label, 'Solo');
  assert.deepEqual(entries[0].entityCounts, { inserter: 2 });
});

test('flatten decomposes a book into children plus a manifest, children first', () => {
  const entries = flatten(
    decode(makeString(book('Rails', [bp('A', ['rail']), bp('B', ['pipe'])]))),
  );
  assert.equal(entries.length, 3);
  const root = entries[entries.length - 1];
  assert.equal(root.kind, 'blueprint_book');
  assert.equal(root.label, 'Rails');
  assert.deepEqual(root.children, [entries[0].hash, entries[1].hash]);
  // Children precede the parent so a caller can insert in one pass.
  assert.equal(entries[0].kind, 'blueprint');
  assert.equal(entries[1].kind, 'blueprint');
});

test('identical content in different book slots is one blob', () => {
  const dup = bp('Same', ['inserter']);
  const entries = flatten(decode(makeString(book('Dups', [dup, dup]))));
  const root = entries[entries.length - 1];
  assert.equal(root.children?.[0], root.children?.[1], 'both slots share a hash');
  assert.equal(new Set(entries.filter((e) => e.kind === 'blueprint').map((e) => e.hash)).size, 1);
});

test("editing one child leaves its siblings' hashes untouched", () => {
  const before = flatten(decode(makeString(book('B', [bp('A', ['rail']), bp('B', ['pipe'])]))));
  const after = flatten(
    decode(makeString(book('B', [bp('A', ['rail']), bp('B', ['pipe', 'pump'])]))),
  );
  assert.equal(before[0].hash, after[0].hash, 'untouched sibling must not re-hash');
  assert.notEqual(before[1].hash, after[1].hash, 'edited child must re-hash');
  assert.notEqual(
    before[before.length - 1].hash,
    after[after.length - 1].hash,
    'book manifest must re-hash',
  );
});

test('book identity ignores payload nesting, so re-nesting an unchanged child is stable', () => {
  // Same children, same order, but the outer string was rebuilt from scratch.
  const a = flatten(decode(makeString(book('X', [bp('A', ['rail'])]))));
  const b = flatten(decode(makeString(book('X', [bp('A', ['rail'])]))));
  assert.equal(a[a.length - 1].hash, b[b.length - 1].hash);
});

test('nested books flatten recursively and are counted once', () => {
  const inner = book('Inner', [bp('Leaf', ['rail'])]);
  const entries = flatten(decode(makeString(book('Outer', [inner, bp('Top', ['pipe'])]))));
  const kinds = entries.map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'blueprint_book').length, 2);
  assert.equal(kinds.filter((k) => k === 'blueprint').length, 2);
  assert.equal(entries[entries.length - 1].label, 'Outer');
});

test('paths encode slot position so an unlabelled blueprint is still addressable', () => {
  const entries = flatten(decode(makeString(book('Bk', [bp(undefined, ['rail']), bp('Named', ['pipe'])]))));
  assert.match(entries[0].path, /^blueprint_book:Bk\/0$/);
  assert.match(entries[1].path, /^blueprint_book:Bk\/1:Named$/);
});

test('deconstruction and upgrade planners decode and flatten', () => {
  for (const kind of ['deconstruction_planner', 'upgrade_planner'] as const) {
    const entries = flatten(decode(makeString({ [kind]: { item: kind, label: 'P', settings: {} } })));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, kind);
    assert.equal(entries[0].label, 'P');
  }
});

test('verifyRoundTrip passes for real payloads', () => {
  const entries = flatten(decode(makeString(bp('V', ['rail', 'rail', 'pipe']))));
  assert.equal(verifyRoundTrip(entries[0]), true);
});

test('formatGameVersion unpacks the packed u64', () => {
  assert.equal(formatGameVersion(562954249175042), '2.1.12.2');
  assert.equal(formatGameVersion(undefined), undefined);
  assert.equal(formatGameVersion('nope'), undefined);
});

test('looksLikeBlueprintString screens candidates cheaply', () => {
  assert.equal(looksLikeBlueprintString(makeString(bp('S', ['rail']))), true);
  assert.equal(looksLikeBlueprintString('hello world'), false);
  assert.equal(looksLikeBlueprintString('1abc'), false);
});
