import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { MapGenSettings } from '../types';
import { toastError } from '../ui';

/**
 * Renders a map preview PNG for the given (unsaved) settings via a backend one-shot.
 * Shows a thumbnail; click it to expand full-res in a lightbox. "Reroll" previews a
 * fresh random seed.
 */
export function MapPreview({ serverId, mapGen }: { serverId: string; mapGen: MapGenSettings }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const urlRef = useRef<string | null>(null);

  // Revoke the previous object URL whenever it changes / on unmount.
  useEffect(() => {
    urlRef.current = url;
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [url]);

  const generate = async (seed?: number) => {
    setBusy(true);
    try {
      const blob = await api.previewMap(serverId, { mapGen, seed, size: 1024 });
      setUrl(URL.createObjectURL(blob));
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <button disabled={busy} onClick={() => void generate()}>
          {busy ? 'Rendering…' : url ? 'Refresh preview' : 'Preview map'}
        </button>
        {url && (
          <button className="ghost small" disabled={busy} onClick={() => void generate(Math.floor(Math.random() * 2 ** 31))}>
            🎲 Reroll seed
          </button>
        )}
        <span className="small muted">Nauvis · renders your current (unsaved) settings</span>
      </div>

      {url && (
        <div style={{ marginTop: 10 }}>
          <img
            src={url}
            alt="Map preview"
            title="Click to expand"
            onClick={() => setExpanded(true)}
            style={{
              width: 260,
              height: 260,
              objectFit: 'cover',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              cursor: 'zoom-in',
              imageRendering: 'pixelated',
            }}
          />
        </div>
      )}

      {expanded && url && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            cursor: 'zoom-out',
            padding: 24,
          }}
        >
          <img
            src={url}
            alt="Map preview (expanded)"
            style={{ maxWidth: '95vw', maxHeight: '95vh', imageRendering: 'pixelated', borderRadius: 8 }}
          />
        </div>
      )}
    </div>
  );
}
