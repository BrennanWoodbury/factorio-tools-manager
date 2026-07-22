import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { run, toastError } from '../ui';

type Settings = Record<string, unknown>;

/**
 * Per-server advanced server-settings. Each field inherits the global default until
 * you change it; a changed field shows a "reset to global" button. On save only the
 * overridden fields (those differing from the global default) are persisted, so the
 * rest keep tracking the global. A raw-JSON escape hatch covers everything else.
 */
export function AdvancedSettings({ serverId }: { serverId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [globalDefaults, setGlobalDefaults] = useState<Settings>({});
  const [saving, setSaving] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getSettings(serverId);
      setSettings(r.settings);
      setGlobalDefaults(r.globalDefaults);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings) return null;

  const set = (key: string, value: unknown) => setSettings((s) => ({ ...(s ?? {}), [key]: value }));
  const num = (key: string, fallback = 0) =>
    typeof settings[key] === 'number' ? (settings[key] as number) : fallback;
  const bool = (key: string) => settings[key] === true;
  const str = (key: string) => (typeof settings[key] === 'string' ? (settings[key] as string) : '');
  const visibility = (settings.visibility ?? {}) as { public?: boolean; lan?: boolean };

  // A field is overridden when it differs from the global default.
  const isOverridden = (key: string) => JSON.stringify(settings[key]) !== JSON.stringify(globalDefaults[key]);
  const fmt = (v: unknown) =>
    typeof v === 'boolean' ? (v ? 'on' : 'off') : v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  /** Inherit indicator / reset-to-global control for a field. */
  const State = ({ k }: { k: string }) =>
    isOverridden(k) ? (
      <button type="button" className="ghost small" onClick={() => set(k, globalDefaults[k])} title="Reset to the global default">
        ↺ global: {fmt(globalDefaults[k])}
      </button>
    ) : (
      <span className="small muted">inherited</span>
    );

  const save = async () => {
    setSaving(true);
    // Send only the fields that differ from the global default (sparse overrides).
    const sparse: Settings = {};
    for (const k of Object.keys(settings)) if (isOverridden(k)) sparse[k] = settings[k];
    await run(async () => {
      const r = await api.updateSettings(serverId, sparse);
      setSettings(r.settings);
      setGlobalDefaults(r.globalDefaults);
    }, 'Advanced settings saved');
    setSaving(false);
  };

  const openRaw = () => {
    setRawText(JSON.stringify(settings, null, 2));
    setRawError(null);
    setRawOpen(true);
  };
  const applyRaw = () => {
    try {
      const parsed = JSON.parse(rawText) as Settings;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Must be a JSON object');
      setSettings(parsed);
      setRawError(null);
      setRawOpen(false);
    } catch (err) {
      setRawError((err as Error).message);
    }
  };

  const row = (label: string, k: string, control: React.ReactNode) => (
    <div className="grow" style={{ minWidth: 200 }}>
      <div className="spread" style={{ alignItems: 'baseline' }}>
        <label>{label}</label>
        <State k={k} />
      </div>
      {control}
    </div>
  );

  return (
    <div className="panel">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Advanced server settings</h2>
        <button className="primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save advanced settings'}
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        Each field inherits the global default (set on the <strong>Defaults</strong> tab) until you
        change it. Written to <span className="mono">server-settings.json</span>; applies on next start.
      </div>

      <div className="row" style={{ marginTop: 12, gap: 20, flexWrap: 'wrap' }}>
        {row(
          'Visibility',
          'visibility',
          <div className="row" style={{ gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={visibility.public === true} onChange={(e) => set('visibility', { ...visibility, public: e.target.checked })} />
              Public
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={visibility.lan !== false} onChange={(e) => set('visibility', { ...visibility, lan: e.target.checked })} />
              LAN
            </label>
          </div>,
        )}
        {row(
          'Require factorio.com verification',
          'require_user_verification',
          <input type="checkbox" style={{ width: 'auto' }} checked={bool('require_user_verification')} onChange={(e) => set('require_user_verification', e.target.checked)} />,
        )}
      </div>

      <div className="row" style={{ marginTop: 6, gap: 20, flexWrap: 'wrap' }}>
        {row('Game password', 'game_password', <input value={str('game_password')} onChange={(e) => set('game_password', e.target.value)} />)}
        {row(
          'Allow commands',
          'allow_commands',
          <select value={str('allow_commands') || 'admins-only'} onChange={(e) => set('allow_commands', e.target.value)}>
            <option value="true">true (anyone)</option>
            <option value="false">false (nobody)</option>
            <option value="admins-only">admins-only</option>
          </select>,
        )}
      </div>

      <div className="row" style={{ marginTop: 6, gap: 20, flexWrap: 'wrap' }}>
        {row('Autosave interval (min)', 'autosave_interval', <input type="number" min={1} value={num('autosave_interval', 10)} onChange={(e) => set('autosave_interval', Number(e.target.value))} />)}
        {row('Autosave slots', 'autosave_slots', <input type="number" min={1} value={num('autosave_slots', 5)} onChange={(e) => set('autosave_slots', Number(e.target.value))} />)}
        {row('AFK autokick (min, 0=off)', 'afk_autokick_interval', <input type="number" min={0} value={num('afk_autokick_interval', 0)} onChange={(e) => set('afk_autokick_interval', Number(e.target.value))} />)}
      </div>

      <div className="row" style={{ marginTop: 6, gap: 20, flexWrap: 'wrap' }}>
        {row('Auto-pause when empty', 'auto_pause', <input type="checkbox" style={{ width: 'auto' }} checked={settings.auto_pause !== false} onChange={(e) => set('auto_pause', e.target.checked)} />)}
        {row('Only admins can pause', 'only_admins_can_pause_the_game', <input type="checkbox" style={{ width: 'auto' }} checked={bool('only_admins_can_pause_the_game')} onChange={(e) => set('only_admins_can_pause_the_game', e.target.checked)} />)}
        {row('Non-blocking saving', 'non_blocking_saving', <input type="checkbox" style={{ width: 'auto' }} checked={settings.non_blocking_saving !== false} onChange={(e) => set('non_blocking_saving', e.target.checked)} />)}
      </div>

      <div style={{ marginTop: 16 }}>
        {!rawOpen ? (
          <button className="ghost small" onClick={openRaw}>
            Edit as raw JSON…
          </button>
        ) : (
          <div>
            <label>Raw server-settings JSON (advanced fields)</label>
            <textarea className="mono" rows={12} value={rawText} onChange={(e) => setRawText(e.target.value)} />
            {rawError && <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>{rawError}</div>}
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={applyRaw}>Apply to form</button>
              <button className="ghost" onClick={() => setRawOpen(false)}>Cancel</button>
              <span className="small muted" style={{ alignSelf: 'center' }}>Applying updates the form — then Save.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
