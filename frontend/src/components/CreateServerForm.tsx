import { useState } from 'react';
import { api } from '../api';
import { toastError, toastSuccess } from '../ui';

export function CreateServerForm({
  onClose,
  onCreated,
  dnsEnabled,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  dnsEnabled: boolean;
}) {
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(0);
  const [description, setDescription] = useState('');
  const [modUser, setModUser] = useState('');
  const [modToken, setModToken] = useState('');
  const [factorioTag, setFactorioTag] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { server } = await api.createServer({
        name,
        subdomain,
        maxPlayers,
        description,
        generateNewSave: true,
        factorioUsername: modUser || undefined,
        factorioToken: modToken || undefined,
        factorioTag: factorioTag.trim() || undefined,
      });
      toastSuccess(`Created "${server.name}"`);
      onCreated(server.id);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 60,
        zIndex: 10,
      }}
      onClick={onClose}
    >
      <form
        className="panel"
        style={{ width: 480, maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>Create server</h2>

        <label>Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />

        <label>Subdomain * (DNS label — lowercase, digits, hyphens)</label>
        <input
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
          placeholder="factory1"
          required
        />
        {dnsEnabled ? (
          <div className="small muted" style={{ marginTop: 4 }}>
            Players will connect to <span className="mono">{subdomain || 'factory1'}.&lt;your-domain&gt;</span>
          </div>
        ) : (
          <div className="small muted" style={{ marginTop: 4 }}>
            DNS automation is off — players connect by <span className="mono">IP:port</span>.
          </div>
        )}

        <label>Max players (0 = unlimited)</label>
        <input
          type="number"
          min={0}
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(Number(e.target.value))}
        />

        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />

        <label>Factorio version (image tag — blank = server default)</label>
        <input
          className="mono"
          value={factorioTag}
          onChange={(e) => setFactorioTag(e.target.value)}
          placeholder="stable"
        />
        <div className="small muted" style={{ marginTop: 4 }}>
          e.g. <span className="mono">stable</span>, <span className="mono">latest</span>, or a pinned
          version like <span className="mono">2.0.55</span>.
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Factorio.com account (optional — for downloading mods & public listing)
          </summary>
          <label>Factorio.com username</label>
          <input value={modUser} onChange={(e) => setModUser(e.target.value)} />
          <label>Factorio.com token</label>
          <input value={modToken} onChange={(e) => setModToken(e.target.value)} type="password" />
        </details>

        <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create server'}
          </button>
        </div>
      </form>
    </div>
  );
}
