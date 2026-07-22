import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { ServersRepo } from '../src/db/serversRepo.js';
import type { ServerRow } from '../src/db/models.js';

/** A complete ServerRow with sensible defaults, overridable per field. */
function row(over: Partial<ServerRow>): ServerRow {
  const id = over.id ?? 'srv1';
  return {
    id,
    name: 'n',
    subdomain: `${id}-sub`,
    description: '',
    max_players: 0,
    game_port: 0,
    rcon_port: 0,
    rcon_password: 'pw',
    save_name: 'default',
    generate_new_save: 1,
    factorio_username: '',
    factorio_token: '',
    container_id: null,
    status: 'stopped',
    created_at: '',
    updated_at: '',
    settings_json: null,
    applied_modpack_id: null,
    whitelist_json: null,
    factorio_tag: '',
    auto_restart: 0,
    adminlist_json: null,
    desired_state: 'stopped',
    auto_backup: 0,
    backup_interval_minutes: 60,
    backup_keep: 10,
    backup_keep_manual: 10,
    auto_restart_overridden: 0,
    auto_backup_overridden: 0,
    backup_interval_minutes_overridden: 0,
    backup_keep_overridden: 0,
    backup_keep_manual_overridden: 0,
    map_gen_settings_json: null,
    map_settings_json: null,
    game_mode: 'space_age',
    lifecycle: 'active',
    expires_at: null,
    draft_state_json: null,
    ...over,
  };
}

test('list() excludes drafts; listDrafts() returns only drafts', () => {
  const repo = new ServersRepo(openDb(':memory:'));
  repo.insert(row({ id: 'active1', subdomain: 'a1' }));
  repo.insert(row({ id: 'draft1', subdomain: '__draft_draft1', lifecycle: 'draft', expires_at: '2999-01-01T00:00:00Z' }));

  const active = repo.list();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'active1');

  const drafts = repo.listDrafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, 'draft1');
});

test('getBySubdomain matches active only (draft placeholders are invisible)', () => {
  const repo = new ServersRepo(openDb(':memory:'));
  repo.insert(row({ id: 'd', subdomain: '__draft_d', lifecycle: 'draft', expires_at: '2999-01-01T00:00:00Z' }));
  assert.equal(repo.getBySubdomain('__draft_d'), undefined);

  repo.insert(row({ id: 'a', subdomain: 'factory1' }));
  assert.equal(repo.getBySubdomain('factory1')?.id, 'a');
});

test('promoteToActive claims subdomain + ports and clears draft state', () => {
  const repo = new ServersRepo(openDb(':memory:'));
  repo.insert(
    row({ id: 'd', subdomain: '__draft_d', lifecycle: 'draft', expires_at: '2999-01-01T00:00:00Z', draft_state_json: '{"source":"generate"}' }),
  );
  repo.promoteToActive('d', 'factory2', 34197, 27015);

  const r = repo.getById('d')!;
  assert.equal(r.lifecycle, 'active');
  assert.equal(r.subdomain, 'factory2');
  assert.equal(r.game_port, 34197);
  assert.equal(r.rcon_port, 27015);
  assert.equal(r.expires_at, null);
  assert.equal(r.draft_state_json, null);
  // Now visible to the operational listing.
  assert.equal(repo.list().length, 1);
  assert.equal(repo.listDrafts().length, 0);
});

test('deleteExpiredDrafts removes only past-deadline drafts', () => {
  const repo = new ServersRepo(openDb(':memory:'));
  repo.insert(row({ id: 'stale', subdomain: '__draft_stale', lifecycle: 'draft', expires_at: '2000-01-01T00:00:00Z' }));
  repo.insert(row({ id: 'fresh', subdomain: '__draft_fresh', lifecycle: 'draft', expires_at: '2999-01-01T00:00:00Z' }));
  repo.insert(row({ id: 'active', subdomain: 'a' })); // never pruned

  const pruned = repo.deleteExpiredDrafts(new Date().toISOString());
  assert.deepEqual(pruned, ['stale']);
  assert.equal(repo.getById('stale'), undefined);
  assert.ok(repo.getById('fresh'));
  assert.ok(repo.getById('active'));
});

test('demoteToDraft reverts a finalize (back to draft, ports cleared)', () => {
  const repo = new ServersRepo(openDb(':memory:'));
  repo.insert(row({ id: 'd', subdomain: 'claimed', lifecycle: 'active', game_port: 34197, rcon_port: 27015 }));
  repo.demoteToDraft('d', '2999-01-01T00:00:00Z');

  const r = repo.getById('d')!;
  assert.equal(r.lifecycle, 'draft');
  assert.equal(r.game_port, 0);
  assert.equal(r.rcon_port, 0);
  assert.equal(r.expires_at, '2999-01-01T00:00:00Z');
});
