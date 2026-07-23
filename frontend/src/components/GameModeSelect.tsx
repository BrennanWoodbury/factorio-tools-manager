import { ExperimentalNote } from './ExperimentalNote';

/** Game mode: drives the map-gen slider set (which planets show) and Space Age mods. */
export function GameModeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (mode: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label>Game mode</label>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 260 }}>
        <option value="vanilla">Vanilla</option>
        <option value="space_age">Space Age</option>
        <option value="space_age_no_quality">Space Age — without Quality</option>
        <option value="modded">Modded</option>
      </select>
      <div className="small muted" style={{ marginTop: 4 }}>
        {value === 'vanilla' && 'Base game — Nauvis only. Space Age mods disabled.'}
        {value === 'space_age' && 'Space Age enabled — per-planet resource sliders.'}
        {value === 'space_age_no_quality' &&
          'Space Age with the Quality mod disabled — per-planet resource sliders.'}
        {value === 'modded' && 'Custom mods (via a modpack). Import an exchange string for modded resources.'}
      </div>
      {value === 'modded' && (
        <ExperimentalNote style={{ marginTop: 6 }}>
          Map generation and previews depend on your mod set — they may not match in-game.
        </ExperimentalNote>
      )}
    </div>
  );
}
