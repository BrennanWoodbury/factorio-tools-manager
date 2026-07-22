import { useEffect, useState } from 'react';

/**
 * A single cascading setting on a server: it either inherits the global default or
 * is overridden. Editing the control commits an override; when overridden, a
 * "Reset to global default: <value>" button returns it to inheriting. Numbers
 * commit on blur/Enter, checkboxes on toggle.
 */
export function OverridableField({
  label,
  kind,
  value,
  globalValue,
  overridden,
  min,
  onCommit,
  onReset,
}: {
  label: string;
  kind: 'number' | 'bool';
  value: number | boolean;
  globalValue: number | boolean;
  overridden: boolean;
  min?: number;
  onCommit: (v: number | boolean) => void;
  onReset: () => void;
}) {
  const fmt = (v: number | boolean) => (kind === 'bool' ? (v ? 'on' : 'off') : String(v));
  // Local buffer for the number input so typing doesn't fire a request per keystroke.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commitNumber = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="spread" style={{ alignItems: 'center', gap: 10 }}>
        <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {kind === 'bool' ? (
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={value as boolean}
              onChange={(e) => onCommit(e.target.checked)}
            />
          ) : (
            <input
              type="number"
              min={min}
              style={{ width: 110 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitNumber}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          )}
          <span>{label}</span>
        </label>
        {overridden ? (
          <button className="ghost small" onClick={onReset}>
            ↺ Reset to global default: {fmt(globalValue)}
          </button>
        ) : (
          <span className="small muted">inherited (global: {fmt(globalValue)})</span>
        )}
      </div>
    </div>
  );
}
