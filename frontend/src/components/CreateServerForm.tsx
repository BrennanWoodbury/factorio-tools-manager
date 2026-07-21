import { useState } from 'react';
import { api } from '../api';
import type { MapGenSettings } from '../types';
import { toastError, toastSuccess } from '../ui';
import { FactorioTagSelect } from './FactorioTagSelect';
import { MapGenEditor } from './MapGenEditor';
import { DnsNamePreview } from './DnsNamePreview';

export function CreateServerForm({
  onClose,
  onCreated,
  dnsEnabled,
  baseDomain,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  dnsEnabled: boolean;
  baseDomain: string | null;
}) {
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(0);
  const [description, setDescription] = useState('');
  const [factorioTag, setFactorioTag] = useState('stable');
  const [mapGen, setMapGen] = useState<MapGenSettings | null>(null);
  const [busy, setBusy] = useState(false);

  // Populate the map-gen editor with defaults the first time it's expanded, so an
  // untouched wizard still creates a server on the image's default generation.
  const initMapGen = async () => {
    if (mapGen) return;
    try {
      setMapGen((await api.mapGenDefaults()).settings);
    } catch (err) {
      toastError((err as Error).message);
    }
  };

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
        factorioTag: factorioTag.trim() || undefined,
        mapGen: mapGen ?? undefined,
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
        <DnsNamePreview subdomain={subdomain} baseDomain={baseDomain} enabled={dnsEnabled} />

        <label>Max players (0 = unlimited)</label>
        <input
          type="number"
          min={0}
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(Number(e.target.value))}
        />

        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />

        <FactorioTagSelect value={factorioTag} onChange={setFactorioTag} />
        <div className="small muted" style={{ marginTop: 4 }}>
          Mods & public listing use the global <strong>Factorio.com account</strong> (set on the
          Servers dashboard) — one account for every server.
        </div>

        <details style={{ marginTop: 12 }} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void initMapGen(); }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Map generation (optional — pick a template or tune ore/water/terrain)
          </summary>
          <div className="small muted" style={{ margin: '8px 0' }}>
            Applied when this server generates its first map. Leave collapsed to use the game's
            defaults. Load a saved <strong>template</strong> or adjust the sliders below.
          </div>
          {mapGen ? (
            <MapGenEditor value={mapGen} onChange={setMapGen} />
          ) : (
            <div className="muted small">Loading defaults…</div>
          )}
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
