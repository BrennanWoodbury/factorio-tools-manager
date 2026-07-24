import { describe, expect, test } from 'vitest';
import { getPath, setPath, levelLabel, previewPlanetsForMode } from './MapGenEditor';

/**
 * These back every slider in the map-gen editor: each one writes through a path
 * into the raw settings object, and a mutation that leaked would corrupt the
 * caller's state or silently drop a sibling key.
 */
describe('path helpers', () => {
  const settings = {
    autoplace_controls: { 'iron-ore': { frequency: 1, size: 1, richness: 1 } },
    water: 1,
  };

  test('reads a nested value', () => {
    expect(getPath(settings, ['autoplace_controls', 'iron-ore', 'frequency'])).toBe(1);
  });

  test('a missing branch reads as undefined rather than throwing', () => {
    expect(getPath(settings, ['nope', 'deeper'])).toBe(undefined);
    expect(getPath(undefined, ['a'])).toBe(undefined);
  });

  test('writing does not mutate the original', () => {
    const next = setPath(settings, ['autoplace_controls', 'iron-ore', 'frequency'], 3);
    expect(next.autoplace_controls['iron-ore'].frequency).toBe(3);
    expect(settings.autoplace_controls['iron-ore'].frequency).toBe(1);
    expect(next).not.toBe(settings);
    expect(next.autoplace_controls['iron-ore']).not.toBe(settings.autoplace_controls['iron-ore']);
  });

  test('writing preserves siblings at every level', () => {
    const next = setPath(settings, ['autoplace_controls', 'iron-ore', 'size'], 2);
    expect(next.water).toBe(1);
    expect(next.autoplace_controls['iron-ore'].frequency).toBe(1);
    expect(next.autoplace_controls['iron-ore'].richness).toBe(1);
  });

  test('creates intermediate objects for a path that does not exist yet', () => {
    const next = setPath({}, ['autoplace_controls', 'coal', 'frequency'], 2);
    expect(next.autoplace_controls.coal.frequency).toBe(2);
  });

  test('arrays stay arrays', () => {
    const next = setPath({ list: [1, 2, 3] }, ['list', 1], 9);
    expect(Array.isArray(next.list)).toBe(true);
    expect(next.list).toEqual([1, 9, 3]);
  });
});

describe('levelLabel', () => {
  test('maps multipliers onto the game’s qualitative scale', () => {
    expect(levelLabel(0)).toBe('None');
    expect(levelLabel(0.25)).toBe('Very low');
    expect(levelLabel(0.7)).toBe('Low');
    expect(levelLabel(1)).toBe('Normal');
    expect(levelLabel(2)).toBe('High');
    expect(levelLabel(4)).toBe('Very high');
  });

  test('boundaries land on the expected side', () => {
    expect(levelLabel(0.49)).toBe('Very low');
    expect(levelLabel(0.5)).toBe('Low');
    expect(levelLabel(0.94)).toBe('Low');
    expect(levelLabel(0.95)).toBe('Normal'); // the "Low" band is exclusive at the top
    expect(levelLabel(1.05)).toBe('Normal');
    expect(levelLabel(1.06)).toBe('High');
    expect(levelLabel(2.5)).toBe('High');
    expect(levelLabel(2.51)).toBe('Very high');
  });
});

describe('previewPlanetsForMode', () => {
  test('vanilla previews Nauvis only', () => {
    expect(previewPlanetsForMode('vanilla').map((p) => p.key)).toEqual(['nauvis']);
  });

  test('both Space Age modes offer the same planets', () => {
    const sa = previewPlanetsForMode('space_age').map((p) => p.key);
    expect(sa).toContain('vulcanus');
    expect(previewPlanetsForMode('space_age_no_quality').map((p) => p.key)).toEqual(sa);
  });
});
