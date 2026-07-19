import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { run, toastError } from '../ui';

type Settings = Record<string, unknown>;

/**
 * Editor for the full server-settings.json body (minus the managed
 * name/description/max_players fields, which live in the basic form). Common
 * fields get structured inputs; a raw-JSON escape hatch covers everything else,
 * guaranteeing parity even for fields without a dedicated input.
 */
export function AdvancedSettings({ serverId }: { serverId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getSettings(serverId);
      setSettings(r.settings);
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

  const save = async () => {
    setSaving(true);
    await run(async () => {
      const r = await api.updateSettings(serverId, settings);
      setSettings(r.settings);
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
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Must be a JSON object');
      }
      setSettings(parsed);
      setRawError(null);
      setRawOpen(false);
    } catch (err) {
      setRawError((err as Error).message);
    }
  };

  return (
    <div className="panel">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Advanced server settings</h2>
        <button className="primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save advanced settings'}
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        Written to <span className="mono">server-settings.json</span>; applies on next start.
      </div>

      <div className="row" style={{ marginTop: 12, gap: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={visibility.public === true}
            onChange={(e) => set('visibility', { ...visibility, public: e.target.checked })}
          />
          Public (listed on the server browser)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={visibility.lan !== false}
            onChange={(e) => set('visibility', { ...visibility, lan: e.target.checked })}
          />
          LAN
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={bool('require_user_verification')}
            onChange={(e) => set('require_user_verification', e.target.checked)}
          />
          Require factorio.com verification
        </label>
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <div className="grow">
          <label>Game password</label>
          <input value={str('game_password')} onChange={(e) => set('game_password', e.target.value)} />
        </div>
        <div className="grow">
          <label>Allow commands</label>
          <select value={str('allow_commands') || 'admin-only'} onChange={(e) => set('allow_commands', e.target.value)}>
            <option value="true">true (anyone)</option>
            <option value="false">false (nobody)</option>
            <option value="admin-only">admin-only</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <div className="grow">
          <label>Autosave interval (min)</label>
          <input
            type="number"
            min={1}
            value={num('autosave_interval', 10)}
            onChange={(e) => set('autosave_interval', Number(e.target.value))}
          />
        </div>
        <div className="grow">
          <label>Autosave slots</label>
          <input
            type="number"
            min={1}
            value={num('autosave_slots', 5)}
            onChange={(e) => set('autosave_slots', Number(e.target.value))}
          />
        </div>
        <div className="grow">
          <label>AFK autokick (min, 0 = off)</label>
          <input
            type="number"
            min={0}
            value={num('afk_autokick_interval', 0)}
            onChange={(e) => set('afk_autokick_interval', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 12, gap: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.auto_pause !== false}
            onChange={(e) => set('auto_pause', e.target.checked)}
          />
          Auto-pause when empty
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={bool('only_admins_can_pause_the_game')}
            onChange={(e) => set('only_admins_can_pause_the_game', e.target.checked)}
          />
          Only admins can pause
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        {!rawOpen ? (
          <button className="ghost small" onClick={openRaw}>
            Edit as raw JSON…
          </button>
        ) : (
          <div>
            <label>Raw server-settings JSON (advanced fields)</label>
            <textarea
              className="mono"
              rows={12}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
            {rawError && (
              <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>
                {rawError}
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={applyRaw}>Apply to form</button>
              <button className="ghost" onClick={() => setRawOpen(false)}>
                Cancel
              </button>
              <span className="small muted" style={{ alignSelf: 'center' }}>
                Applying updates the form above — then Save.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
