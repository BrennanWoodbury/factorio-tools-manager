import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { FactorioAccount } from '../types';
import { run, toastError } from '../ui';

/**
 * The single global Factorio.com account (username + token) applied to every
 * server — used to download mods from the mod portal and for the game's public
 * server listing. Stored in the app's database; there are no per-server credentials.
 */
export function FactorioAccountPanel() {
  const [account, setAccount] = useState<FactorioAccount | null>(null);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { factorio } = await api.getFactorioAccount();
      setAccount(factorio);
      setUsername(factorio.username);
      setToken('');
    } catch (err) {
      toastError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account) return null;

  const save = async () => {
    setBusy(true);
    const patch: { username?: string; token?: string } = { username };
    // Only send the token when the admin actually typed one (blank keeps the current).
    if (token.trim()) patch.token = token.trim();
    await run(async () => {
      const r = await api.setFactorioAccount(patch);
      setAccount(r.factorio);
      setToken('');
    }, 'Factorio.com account saved');
    setBusy(false);
    await load();
  };

  const clearToken = async () => {
    if (!confirm('Remove the Factorio.com token? Mods can’t be downloaded until it’s set again.'))
      return;
    await run(() => api.setFactorioAccount({ token: '' }), 'Token cleared');
    await load();
  };

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>
          Factorio.com account{' '}
          <span
            className={`badge ${account.configured ? 'running' : 'stopped'}`}
            style={{ marginLeft: 6 }}
          >
            <span className="dot" />
            {account.configured ? 'Set' : 'Not set'}
          </span>
        </h2>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="small muted" style={{ marginBottom: 12 }}>
        One account for every server — used to download mods from the mod portal and for the public
        server listing. Get your token at{' '}
        <span className="mono">factorio.com → Profile</span>. Stored in the app's database.
      </div>

      <div className="row">
        <div className="grow">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="grow">
          <label>Token {account.hasToken ? '(set — blank keeps it)' : '(not set)'}</label>
          <input
            type="password"
            placeholder={account.hasToken ? '••••••••' : 'Factorio.com token'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      </div>

      {account.hasToken && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger ghost" onClick={() => void clearToken()}>
            Clear token
          </button>
        </div>
      )}
    </div>
  );
}
