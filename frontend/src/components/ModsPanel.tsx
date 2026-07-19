import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ModEntry, Server } from '../types';
import { run, toastError, toastSuccess } from '../ui';

export function ModsPanel({ server }: { server: Server }) {
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [newMod, setNewMod] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.getMods(server.id);
      setMods(r.mods);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, [server.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const addMod = () => {
    const name = newMod.trim();
    if (!name || mods.some((m) => m.name === name)) return;
    setMods((m) => [...m, { name, enabled: true }]);
    setNewMod('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.putMods(server.id, mods);
      setMods(r.mods);
      if (r.errors.length > 0) {
        toastError(`Some mods failed: ${r.errors.map((e) => `${e.name} (${e.error})`).join('; ')}`);
      } else {
        toastSuccess(
          r.downloaded.length > 0
            ? `Saved. Downloaded: ${r.downloaded.map((d) => `${d.name}@${d.version}`).join(', ')}`
            : 'Mod list saved',
        );
      }
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Mods</h2>
        <button className="primary" disabled={saving} onClick={() => void run(save)}>
          {saving ? 'Applying…' : 'Save & download'}
        </button>
      </div>

      {!server.hasModPortalCredentials && (
        <div className="small muted" style={{ marginBottom: 10 }}>
          No mod portal credentials set (Settings tab). You can still edit the list, but enabled mods
          can't be downloaded until credentials are provided. Restart the server to apply changes.
        </div>
      )}

      <table>
        <tbody>
          {mods.map((m, i) => (
            <tr key={m.name}>
              <td className="mono">
                {m.name}
                {m.name === 'base' && <span className="small muted"> (required)</span>}
              </td>
              <td style={{ width: 90 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={m.enabled}
                    disabled={m.name === 'base'}
                    onChange={(e) =>
                      setMods((cur) =>
                        cur.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)),
                      )
                    }
                  />
                  enabled
                </label>
              </td>
              <td style={{ width: 60 }}>
                {m.name !== 'base' && (
                  <button
                    className="danger ghost"
                    onClick={() => setMods((cur) => cur.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ marginTop: 12 }}>
        <input
          className="grow mono"
          placeholder="mod portal name (e.g. space-exploration)"
          value={newMod}
          onChange={(e) => setNewMod(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addMod()}
        />
        <button onClick={addMod}>Add</button>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        Changes take effect on the next server start/restart.
      </div>
    </div>
  );
}
