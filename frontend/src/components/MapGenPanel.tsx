import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { MapGenSettings, Server } from '../types';
import { run, toastError } from '../ui';
import { MapGenEditor } from './MapGenEditor';
import { MapPreview } from './MapPreview';

export function MapGenPanel({ server }: { server: Server }) {
  const [mapGen, setMapGen] = useState<MapGenSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMapGen((await api.getMapGen(server.id)).mapGen);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, [server.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!mapGen) return <div className="muted">Loading…</div>;

  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.setMapGen(server.id, { mapGen }), 'Map generation settings saved');
    setBusy(false);
    if (ok) await load();
  };

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Map generation</h2>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="small muted" style={{ marginBottom: 16 }}>
        These apply to the <strong>next new map generated</strong> — a first start with no save, or a
        new save created from the Saves tab. They don't change an existing world. Current selected
        save: <span className="mono">{server.saveName}</span>. Manage reusable presets under{' '}
        <strong>Templates</strong>.
      </div>
      <MapPreview serverId={server.id} mapGen={mapGen} />
      <MapGenEditor value={mapGen} onChange={setMapGen} />
    </div>
  );
}
