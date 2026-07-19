import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CatalogEntry, ModEntry, Server } from '../types';
import { run, toastError, toastSuccess } from '../ui';

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function ModsPanel({ server }: { server: Server }) {
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [saving, setSaving] = useState(false);

  // Mod portal search state.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

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

  // Debounced search against the mod portal catalog.
  useEffect(() => {
    clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const r = await api.searchMods(query);
        setResults(r.results);
      } catch (err) {
        toastError((err as Error).message);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [query]);

  const addByName = (name: string) => {
    if (!name || mods.some((m) => m.name === name)) return;
    setMods((m) => [...m, { name, enabled: true }]);
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

      <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <label style={{ marginTop: 0 }}>Search the mod portal</label>
        <input
          className="grow"
          placeholder="e.g. space exploration, bob, logistics…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <div className="small muted" style={{ marginTop: 8 }}>Searching…</div>}

        {results.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((r) => {
              const added = mods.some((m) => m.name === r.name);
              return (
                <div
                  key={r.name}
                  className="spread"
                  style={{
                    alignItems: 'flex-start',
                    background: 'var(--panel-2)',
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div>
                      <strong>{r.title}</strong>{' '}
                      <span className="small muted">by {r.owner}</span>
                    </div>
                    <div className="small mono muted">{r.name}</div>
                    {r.summary && (
                      <div
                        className="small muted"
                        style={{
                          marginTop: 4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {r.summary}
                      </div>
                    )}
                    <div className="small muted" style={{ marginTop: 4 }}>
                      ⬇ {fmtDownloads(r.downloadsCount)}
                      {r.latestVersion ? ` · v${r.latestVersion}` : ''}
                      {r.factorioVersion ? ` · Factorio ${r.factorioVersion}` : ''}
                    </div>
                  </div>
                  <button disabled={added} onClick={() => addByName(r.name)}>
                    {added ? 'Added' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {query.trim().length >= 2 && !searching && results.length === 0 && (
          <div className="small muted" style={{ marginTop: 8 }}>
            No matching mods.
          </div>
        )}
      </div>

      <div className="small muted" style={{ marginTop: 12 }}>
        Added mods still need <strong>Save &amp; download</strong> above, then take effect on the
        next server start/restart.
      </div>
    </div>
  );
}
