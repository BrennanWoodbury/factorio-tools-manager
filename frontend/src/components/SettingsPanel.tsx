import { useState } from 'react';
import { api } from '../api';
import type { Server } from '../types';
import { run } from '../ui';
import { AdvancedSettings } from './AdvancedSettings';
import { WhitelistPanel } from './WhitelistPanel';

export function SettingsPanel({
  server,
  onChanged,
  onDeleted,
}: {
  server: Server;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(server.name);
  const [subdomain, setSubdomain] = useState(server.subdomain);
  const [maxPlayers, setMaxPlayers] = useState(server.maxPlayers);
  const [description, setDescription] = useState(server.description);
  const [modUser, setModUser] = useState('');
  const [modToken, setModToken] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const patch: Record<string, unknown> = { name, subdomain, maxPlayers, description };
    if (modUser) patch.factorioUsername = modUser;
    if (modToken) patch.factorioToken = modToken;
    await run(() => api.updateServer(server.id, patch), 'Settings saved');
    setModUser('');
    setModToken('');
    setBusy(false);
    onChanged();
  };

  const remove = async () => {
    if (!confirm(`Delete server "${server.name}"? This removes the container, DNS record, ports and all data.`))
      return;
    const ok = await run(() => api.deleteServer(server.id), 'Server deleted');
    if (ok) onDeleted();
  };

  return (
    <>
      <div className="panel">
        <h2>Settings</h2>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />

        <label>Subdomain (changing this updates the SRV record)</label>
        <input value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase())} />

        <label>Max players (0 = unlimited)</label>
        <input type="number" min={0} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />

        <label>Description</label>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />

        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Update Factorio.com credentials (mods & public listing){' '}
            {server.hasFactorioCredentials ? '(currently set)' : '(not set)'}
          </summary>
          <label>Factorio.com username</label>
          <input value={modUser} onChange={(e) => setModUser(e.target.value)} />
          <label>Factorio.com token</label>
          <input type="password" value={modToken} onChange={(e) => setModToken(e.target.value)} />
        </details>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          <span className="small muted" style={{ alignSelf: 'center' }}>
            Name/players/description apply on next start.
          </span>
        </div>
      </div>

      <AdvancedSettings serverId={server.id} />

      <WhitelistPanel
        title="Player whitelist"
        description="Only these Factorio usernames may join this server (in addition to the global whitelist). Applies on next start/restart."
        load={async () => (await api.getWhitelist(server.id)).whitelist}
        save={async (names) => (await api.setWhitelist(server.id, names)).whitelist}
      />

      <div className="panel" style={{ borderColor: 'var(--red)' }}>
        <h2 style={{ color: 'var(--red)' }}>Danger zone</h2>
        <div className="spread">
          <span className="muted small">
            Permanently delete this server, its container, DNS record, port allocation and data.
          </span>
          <button className="danger" onClick={() => void remove()}>
            Delete server
          </button>
        </div>
      </div>
    </>
  );
}
