import { useState } from 'react';

type Mode = 'stable' | 'latest' | 'custom';

function tagToMode(tag: string): Mode {
  if (tag === '' || tag === 'stable') return 'stable';
  if (tag === 'latest') return 'latest';
  return 'custom';
}

/**
 * Factorio version picker: a dropdown of stable / latest (experimental) / custom.
 * "custom" reveals a free-text field for an arbitrary image tag. Emits the chosen
 * tag string ('stable', 'latest', or the custom value) via onChange.
 */
export function FactorioTagSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (tag: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(tagToMode(value));
  const [custom, setCustom] = useState(tagToMode(value) === 'custom' ? value : '');

  const emit = (m: Mode, c: string) =>
    onChange(m === 'stable' ? 'stable' : m === 'latest' ? 'latest' : c.trim());

  return (
    <>
      <label>Factorio version</label>
      <select
        value={mode}
        onChange={(e) => {
          const m = e.target.value as Mode;
          setMode(m);
          emit(m, custom);
        }}
      >
        <option value="stable">stable</option>
        <option value="latest">latest (experimental)</option>
        <option value="custom">custom…</option>
      </select>
      {mode === 'custom' && (
        <input
          className="mono"
          style={{ marginTop: 6 }}
          placeholder="image tag, e.g. 2.0.55"
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            emit('custom', e.target.value);
          }}
        />
      )}
    </>
  );
}
