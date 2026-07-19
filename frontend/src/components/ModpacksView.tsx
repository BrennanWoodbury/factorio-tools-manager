import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Modpack } from '../types';
import { run, toastError, toastSuccess } from '../ui';

/** The shared modpack registry: list, create, import. */
export function ModpacksView({ onOpen }: { onOpen: (id: string) => void }) {
  const [packs, setPacks] = useState<Modpack[]>([]);
  const [newName, setNewName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.listModpacks();
      setPacks(r.modpacks);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await api.createModpack(name);
      setNewName('');
      await load();
      onOpen(r.pack.id);
    } catch (err) {
      toastError((err as Error).message);
    }
  };

  const importFile = async (file: File) => {
    try {
      const manifest = JSON.parse(await file.text());
      const r = await api.importModpack(manifest);
      toastSuccess(`Imported "${r.pack.name}"`);
      await load();
      onOpen(r.pack.id);
    } catch (err) {
      toastError(`Import failed: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <div className="panel">
        <div className="spread">
          <div>
            <h2 style={{ margin: 0 }}>Modpacks</h2>
            <div className="small muted" style={{ marginTop: 4 }}>
              Reusable mod collections you can apply to any server. Manifests only — servers download
              the mods themselves.
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importFile(f);
            }}
          />
          <button onClick={() => fileRef.current?.click()}>Import…</button>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <input
            className="grow"
            placeholder="New modpack name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <button className="primary" onClick={() => void create()}>
            Create
          </button>
        </div>
      </div>

      {packs.length === 0 && <div className="panel muted">No modpacks yet.</div>}

      {packs.map((p) => (
        <div key={p.id} className="server-card" onClick={() => onOpen(p.id)}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
            <div className="small muted">
              {p.modCount} mod{p.modCount === 1 ? '' : 's'}
              {p.description ? ` · ${p.description}` : ''}
            </div>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <a href={api.exportModpackUrl(p.id)} onClick={(e) => e.stopPropagation()}>
              <button className="ghost small">Export</button>
            </a>
            <button
              className="danger ghost small"
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete modpack "${p.name}"?`)) return;
                await run(() => api.deleteModpack(p.id), 'Modpack deleted');
                await load();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
