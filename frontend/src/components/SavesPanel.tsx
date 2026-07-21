import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { SaveInfo, Server } from '../types';
import { run, toastError } from '../ui';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SavesPanel({ server, onChanged }: { server: Server; onChanged: () => void }) {
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const [selected, setSelected] = useState(server.saveName);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.listSaves(server.id);
      setSaves(r.saves);
      setSelected(r.selected);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, [server.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    await run(async () => {
      await api.uploadSave(server.id, file);
    }, 'Save uploaded');
    setUploading(false);
    await load();
  };

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Saves</h2>
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          <button
            disabled={uploading}
            title="Generate a fresh map (server must be stopped)"
            onClick={async () => {
              const name = prompt('New save name (server must be stopped):', 'my-save');
              if (!name) return;
              const ok = await run(() => api.createSave(server.id, name), 'Save created');
              if (ok) await load();
            }}
          >
            + New save
          </button>
          <button className="primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : 'Upload .zip'}
          </button>
        </div>
      </div>

      {saves.length === 0 && (
        <div className="muted small">
          No saves yet. A new save named <span className="mono">{server.saveName}</span> is generated
          on first start, or upload one here.
        </div>
      )}

      {saves.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Modified</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {saves.map((s) => (
              <tr key={s.name}>
                <td className="mono">
                  {s.name}
                  {s.name === selected && (
                    <span className="badge running" style={{ marginLeft: 8 }}>
                      selected
                    </span>
                  )}
                </td>
                <td>{fmtSize(s.sizeBytes)}</td>
                <td className="small muted">{new Date(s.modifiedAt).toLocaleString()}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button
                      className="primary small"
                      title="Load this save now (restarts the server)"
                      onClick={async () => {
                        if (
                          !confirm(
                            `Restore the server onto "${s.name}"? This (re)starts the server and loads that save — any unsaved progress in the current game is lost.`,
                          )
                        )
                          return;
                        const ok = await run(
                          () => api.restoreSave(server.id, s.name),
                          `Restored — loading "${s.name}"`,
                        );
                        if (ok) {
                          await load();
                          onChanged();
                        }
                      }}
                    >
                      Restore
                    </button>
                    {s.name !== selected && (
                      <button
                        className="small"
                        title="Select for the next start (no restart)"
                        onClick={async () => {
                          await run(() => api.selectSave(server.id, s.name), 'Save selected');
                          await load();
                          onChanged();
                        }}
                      >
                        Load next
                      </button>
                    )}
                    <a href={api.downloadSaveUrl(server.id, s.name)}>
                      <button className="small">Download</button>
                    </a>
                    <button
                      className="danger small"
                      onClick={async () => {
                        if (!confirm(`Delete save "${s.name}"?`)) return;
                        await run(() => api.deleteSave(server.id, s.name), 'Deleted');
                        await load();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
