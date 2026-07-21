import { kvGet, kvSet, type DB } from '../db/index.js';

/**
 * The single Factorio.com account (username + token) used by every server — for
 * downloading mods from the mod portal and for the game's public-server listing.
 * Persisted in the DB (kv) and edited from the dashboard; there are no per-server
 * credentials. The same username/token is valid for both uses.
 */
export interface FactorioAccount {
  username: string;
  token: string;
}

const K = { username: 'factorio_account_username', token: 'factorio_account_token' } as const;

export function getFactorioAccount(db: DB): FactorioAccount {
  return { username: kvGet(db, K.username) ?? '', token: kvGet(db, K.token) ?? '' };
}

export function setFactorioAccount(db: DB, patch: { username?: string; token?: string }): void {
  if (patch.username !== undefined) kvSet(db, K.username, patch.username.trim());
  if (patch.token !== undefined) kvSet(db, K.token, patch.token.trim());
}

/** Both fields present — required to download mods / list publicly. */
export function factorioAccountConfigured(a: FactorioAccount): boolean {
  return a.username !== '' && a.token !== '';
}

/** UI-facing view: the token is never returned, only whether it's set. */
export function factorioAccountDto(a: FactorioAccount) {
  return {
    username: a.username,
    hasToken: a.token !== '',
    configured: factorioAccountConfigured(a),
  };
}
