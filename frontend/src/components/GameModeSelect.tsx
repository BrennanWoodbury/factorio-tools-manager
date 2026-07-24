import { ExperimentalNote } from './ExperimentalNote';

const MODES: { value: string; label: string; hint: string }[] = [
  { value: 'vanilla', label: 'Vanilla', hint: 'Base game — Nauvis only. Space Age mods disabled.' },
  { value: 'space_age', label: 'Space Age', hint: 'Space Age enabled — per-planet resource sliders.' },
  {
    value: 'space_age_no_quality',
    label: 'Space Age — without Quality',
    hint: 'Space Age with the Quality mod disabled — per-planet resource sliders.',
  },
  {
    value: 'modded',
    label: 'Modded',
    hint: 'Custom mods (via a modpack). Import an exchange string for modded resources.',
  },
];

/**
 * Game mode: drives the map-gen slider set (which planets show) and which bundled
 * expansion mods are enabled.
 *
 * `modeIssues` comes from the chosen Factorio image and marks modes it can't run —
 * "without Quality" is impossible before 2.1, where space-age hard-requires quality.
 * It's a hint, not enforcement: absent (image not pulled yet) simply means no
 * annotation, and the server still refuses the combination on start.
 */
export function GameModeSelect({
  value,
  onChange,
  disabled = false,
  modeIssues,
}: {
  value: string;
  onChange: (mode: string) => void;
  disabled?: boolean;
  modeIssues?: Record<string, string>;
}) {
  const issueFor = (mode: string) => modeIssues?.[mode];
  const currentIssue = issueFor(value);

  return (
    <div>
      <label>Game mode</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ maxWidth: 260 }}
      >
        {MODES.map((m) => (
          // A blocked mode stays selectable-looking only if it's the current value,
          // so an existing server doesn't silently render as something it isn't.
          <option key={m.value} value={m.value} disabled={!!issueFor(m.value) && m.value !== value}>
            {m.label}
            {issueFor(m.value) ? ' (unavailable)' : ''}
          </option>
        ))}
      </select>
      <div className="small muted" style={{ marginTop: 4 }}>
        {MODES.find((m) => m.value === value)?.hint}
      </div>
      {currentIssue && (
        <div className="small" style={{ marginTop: 6, color: 'var(--red)' }}>
          {currentIssue}
        </div>
      )}
      {value === 'modded' && (
        <ExperimentalNote style={{ marginTop: 6 }}>
          Map generation and previews depend on your mod set — they may not match in-game.
        </ExperimentalNote>
      )}
    </div>
  );
}
