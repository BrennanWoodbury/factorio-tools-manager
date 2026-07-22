import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { MapGenSettings, MapGenTemplate } from '../types';
import { run, toastError } from '../ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- tiny immutable path helpers over the raw settings object ----

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

/** A titled, bordered, tinted box grouping one thing's sliders (e.g. one ore). */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        background: 'var(--panel-2)',
        borderRadius: 'var(--radius)',
        padding: '12px 14px',
        marginBottom: 12,
      }}
    >
      <div className="mono" style={{ fontWeight: 600, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

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

/**
 * Controlled editor for a map-gen-settings object, presented as the in-game
 * map-generation sliders. Optionally shows a template bar (load a saved preset into
 * the editor / save the current settings as a new template). The parent owns
 * persistence — this component only reads `value` and emits `onChange`.
 */
export function MapGenEditor({
  value,
  onChange,
  showTemplates = true,
}: {
  value: MapGenSettings;
  onChange: (v: MapGenSettings) => void;
  showTemplates?: boolean;
}) {
  const [templates, setTemplates] = useState<MapGenTemplate[]>([]);

  const loadTemplates = useCallback(async () => {
    if (!showTemplates) return;
    try {
      setTemplates((await api.listMapGenTemplates()).templates);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, [showTemplates]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const g = (path: (string | number)[], dflt = 1): number => {
    const v = getPath(value, path);
    return typeof v === 'number' ? v : dflt;
  };
  const sg = (path: (string | number)[], v: number | boolean | null) => onChange(setPath(value, path, v));
  const control = (key: string, field: 'frequency' | 'size' | 'richness') =>
    g(['autoplace_controls', key, field]);
  const setControl = (key: string, field: 'frequency' | 'size' | 'richness', v: number) =>
    sg(['autoplace_controls', key, field], v);

  const cliffInterval = g(['cliff_settings', 'cliff_elevation_interval'], 40);
  const cliffFreq = cliffInterval > 0 ? 40 / cliffInterval : 0;
  const cliffRichness = g(['cliff_settings', 'richness']);
  const setCliffFreq = (freq: number) =>
    onChange(setPath(value, ['cliff_settings', 'cliff_elevation_interval'], freq > 0 ? 40 / freq : 40));

  const peaceful = getPath(value, ['peaceful_mode']) === true;
  const seedRaw = getPath(value, ['seed']);
  const seed = typeof seedRaw === 'number' ? String(seedRaw) : '';

  const applyTemplate = async (id: string) => {
    if (!id) return;
    try {
      const t = await api.getMapGenTemplate(id);
      onChange(t.settings);
    } catch (err) {
      toastError((err as Error).message);
    }
  };

  const saveAsTemplate = async () => {
    const name = prompt('Save current settings as a template named:');
    if (!name?.trim()) return;
    const ok = await run(
      () => api.createMapGenTemplate({ name: name.trim(), settings: value }),
      `Saved template "${name.trim()}"`,
    );
    if (ok) await loadTemplates();
  };

  return (
    <div>
      {showTemplates && (
        <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <select
            defaultValue=""
            onChange={(e) => {
              void applyTemplate(e.target.value);
              e.target.value = '';
            }}
            style={{ maxWidth: 220 }}
          >
            <option value="">Load a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="button" className="small" onClick={() => void saveAsTemplate()}>
            Save as template
          </button>
        </div>
      )}

      <h3 style={{ marginBottom: 8, marginTop: 0 }}>Resources</h3>
      <div className="small muted" style={{ marginBottom: 12 }}>
        Frequency = how often patches occur · Size = patch size · Richness = yield per tile.
      </div>
      {RESOURCES.map((r) => (
        <Group key={r.key} title={r.label}>
          <Slider
            label="Frequency"
            value={control(r.key, 'frequency')}
            onChange={(v) => setControl(r.key, 'frequency', v)}
          />
          <Slider label="Size" value={control(r.key, 'size')} onChange={(v) => setControl(r.key, 'size', v)} />
          {r.richness && (
            <Slider
              label="Richness"
              value={control(r.key, 'richness')}
              onChange={(v) => setControl(r.key, 'richness', v)}
            />
          )}
        </Group>
      ))}

      <h3 style={{ marginBottom: 12 }}>Terrain &amp; enemies</h3>
      {TERRAIN.map((t) => (
        <Group key={t.key} title={t.label}>
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
        </Group>
      ))}

      <Group title="Cliffs">
        <Slider label="Frequency" value={cliffFreq} onChange={setCliffFreq} />
        <Slider
          label="Continuity"
          value={cliffRichness}
          max={10}
          onChange={(v) => sg(['cliff_settings', 'richness'], v)}
        />
      </Group>

      <Group title="Starting area">
        <Slider label="Size" value={g(['starting_area'])} onChange={(v) => sg(['starting_area'], v)} />
      </Group>

      <Group title="World options">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={peaceful}
            onChange={(e) => sg(['peaceful_mode'], e.target.checked)}
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
            onChange(setPath(value, ['seed'], val === '' ? null : Number(val)));
          }}
        />
      </Group>
    </div>
  );
}
