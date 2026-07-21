import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { MapGenSettings, Server } from '../types';
import { run, toastError } from '../ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- tiny immutable path helpers over the raw settings objects ----

function getPath(obj: any, path: (string | number)[]): any {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj: any, path: (string | number)[], value: any): any {
  const [k, ...rest] = path;
  const clone: any = Array.isArray(obj) ? [...obj] : { ...(obj ?? {}) };
  clone[k] = rest.length ? setPath(clone[k], rest, value) : value;
  return clone;
}

/** Qualitative label for a frequency/size/richness multiplier (matches the game's feel). */
function levelLabel(v: number): string {
  if (v <= 0) return 'None';
  if (v < 0.5) return 'Very low';
  if (v < 0.95) return 'Low';
  if (v <= 1.05) return 'Normal';
  if (v <= 2.5) return 'High';
  return 'Very high';
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 6,
  step = 0.05,
  showLevel = true,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  showLevel?: boolean;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="spread" style={{ marginBottom: 2 }}>
        <span className="small">{label}</span>
        <span className="small muted mono">
          ×{value.toFixed(2)}
          {showLevel ? ` · ${levelLabel(value)}` : ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

// Resources shown in the "Resources" section. `richness: false` for the terrain/enemy
// autoplace entries that only take frequency + size (water, trees, enemy bases).
const RESOURCES: { key: string; label: string; richness: boolean }[] = [
  { key: 'iron-ore', label: 'Iron ore', richness: true },
  { key: 'copper-ore', label: 'Copper ore', richness: true },
  { key: 'coal', label: 'Coal', richness: true },
  { key: 'stone', label: 'Stone', richness: true },
  { key: 'uranium-ore', label: 'Uranium ore', richness: true },
  { key: 'crude-oil', label: 'Oil', richness: true },
];

const TERRAIN: { key: string; label: string }[] = [
  { key: 'water', label: 'Water' },
  { key: 'trees', label: 'Trees' },
  { key: 'enemy-base', label: 'Enemy bases' },
];

export function MapGenPanel({ server }: { server: Server }) {
  const [mapGen, setMapGen] = useState<MapGenSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.getMapGen(server.id);
      setMapGen(r.mapGen);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, [server.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!mapGen) return <div className="muted">Loading…</div>;

  // convenience getters/setters bound to the two raw objects
  const g = (path: (string | number)[], dflt = 1): number => {
    const v = getPath(mapGen, path);
    return typeof v === 'number' ? v : dflt;
  };
  const sg = (path: (string | number)[], v: number) => setMapGen((m) => setPath(m, path, v));
  const control = (key: string, field: 'frequency' | 'size' | 'richness') =>
    g(['autoplace_controls', key, field]);
  const setControl = (key: string, field: 'frequency' | 'size' | 'richness', v: number) =>
    sg(['autoplace_controls', key, field], v);

  // Cliffs: the game's "frequency" is 40 / cliff_elevation_interval; "continuity" is richness.
  const cliffInterval = g(['cliff_settings', 'cliff_elevation_interval'], 40);
  const cliffFreq = cliffInterval > 0 ? 40 / cliffInterval : 0;
  const cliffRichness = g(['cliff_settings', 'richness']);
  const setCliffFreq = (freq: number) =>
    setMapGen((m) => setPath(m, ['cliff_settings', 'cliff_elevation_interval'], freq > 0 ? 40 / freq : 40));

  const peaceful = getPath(mapGen, ['peaceful_mode']) === true;
  const seedRaw = getPath(mapGen, ['seed']);
  const seed = typeof seedRaw === 'number' ? String(seedRaw) : '';

  const save = async () => {
    setBusy(true);
    const ok = await run(
      () => api.setMapGen(server.id, { mapGen: mapGen ?? {} }),
      'Map generation settings saved',
    );
    setBusy(false);
    if (ok) await load();
  };

  return (
    <>
      <div className="panel">
        <div className="spread" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Map generation</h2>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="small muted" style={{ marginBottom: 16 }}>
          These apply to the <strong>next new map generated</strong> — a first start with no save, or
          a new save created from the Saves tab. They don't change an existing world. Current selected
          save: <span className="mono">{server.saveName}</span>.
        </div>

        <h3 style={{ marginBottom: 8 }}>Resources</h3>
        <div className="small muted" style={{ marginBottom: 12 }}>
          Frequency = how often patches occur · Size = patch size · Richness = yield per tile.
        </div>
        {RESOURCES.map((r) => (
          <div key={r.key} style={{ marginBottom: 14 }}>
            <div className="small mono" style={{ marginBottom: 4 }}>
              {r.label}
            </div>
            <Slider
              label="Frequency"
              value={control(r.key, 'frequency')}
              onChange={(v) => setControl(r.key, 'frequency', v)}
            />
            <Slider
              label="Size"
              value={control(r.key, 'size')}
              onChange={(v) => setControl(r.key, 'size', v)}
            />
            {r.richness && (
              <Slider
                label="Richness"
                value={control(r.key, 'richness')}
                onChange={(v) => setControl(r.key, 'richness', v)}
              />
            )}
          </div>
        ))}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Terrain &amp; enemies</h3>
        {TERRAIN.map((t) => (
          <div key={t.key} style={{ marginBottom: 14 }}>
            <div className="small mono" style={{ marginBottom: 4 }}>
              {t.label}
            </div>
            <Slider
              label={t.key === 'water' ? 'Scale' : 'Frequency'}
              value={control(t.key, 'frequency')}
              onChange={(v) => setControl(t.key, 'frequency', v)}
            />
            <Slider
              label={t.key === 'water' ? 'Coverage' : 'Size'}
              value={control(t.key, 'size')}
              onChange={(v) => setControl(t.key, 'size', v)}
            />
          </div>
        ))}

        <div style={{ marginBottom: 14 }}>
          <div className="small mono" style={{ marginBottom: 4 }}>
            Cliffs
          </div>
          <Slider label="Frequency" value={cliffFreq} onChange={setCliffFreq} />
          <Slider
            label="Continuity"
            value={cliffRichness}
            max={10}
            onChange={(v) => sg(['cliff_settings', 'richness'], v)}
          />
        </div>

        <Slider
          label="Starting area size"
          value={g(['starting_area'])}
          onChange={(v) => sg(['starting_area'], v)}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={peaceful}
            onChange={(e) => setMapGen((m) => setPath(m, ['peaceful_mode'], e.target.checked))}
          />
          Peaceful mode (enemies don't attack unless provoked)
        </label>

        <label style={{ marginTop: 14 }}>Map seed (blank = random)</label>
        <input
          type="number"
          value={seed}
          placeholder="random"
          onChange={(e) => {
            const val = e.target.value.trim();
            setMapGen((m) => setPath(m, ['seed'], val === '' ? null : Number(val)));
          }}
        />
      </div>
    </>
  );
}
