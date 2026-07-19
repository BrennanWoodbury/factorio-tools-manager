import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CatalogEntry } from '../types';
import { toastError } from '../ui';

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/**
 * Debounced Factorio Mod Portal search box with a results list. Reused by both
 * the per-server Mods tab and the modpack editor. Calls `onAdd(name)` when the
 * user clicks Add; `isAdded(name)` controls the disabled/"Added" state.
 */
export function ModSearchBox({
  onAdd,
  isAdded,
}: {
  onAdd: (name: string) => void;
  isAdded: (name: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

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

  return (
    <div>
      <label style={{ marginTop: 0 }}>Search the mod portal</label>
      <input
        placeholder="e.g. space exploration, bob, logistics…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {searching && <div className="small muted" style={{ marginTop: 8 }}>Searching…</div>}

      {results.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((r) => {
            const added = isAdded(r.name);
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
                    <strong>{r.title}</strong> <span className="small muted">by {r.owner}</span>
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
                <button disabled={added} onClick={() => onAdd(r.name)}>
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
  );
}
