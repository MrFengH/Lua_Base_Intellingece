import { describe, expect, it } from 'vitest';
import type { ApproximateAge } from '@/domain';
import {
  AGE_BAND_INDETERMINATE_LABEL,
  AGE_BAND_UNKNOWN_LABEL,
  AGE_BANDS,
  classifyAgeBand,
} from '@/domain';

describe('AGE_BANDS configuration', () => {
  it('is the explicit, non-clinical, three-band boundary set the dashboard renders', () => {
    expect(AGE_BANDS).toEqual([
      { min: 0, max: 5, label: '0–5 años' },
      { min: 6, max: 10, label: '6–10 años' },
      { min: 11, max: null, label: 'Más de 10 años' },
    ]);
  });
});

describe('classifyAgeBand — exact and single-valued ages', () => {
  it.each([
    [0, '0–5 años'],
    [5, '0–5 años'],
    [6, '6–10 años'],
    [10, '6–10 años'],
    [11, 'Más de 10 años'],
    [40, 'Más de 10 años'],
  ])('places an exact age of %i years in "%s"', (years, label) => {
    expect(classifyAgeBand({ type: 'exact', years })).toEqual({ kind: 'known', label });
  });

  it.each([
    [0, '0–5 años'],
    [5, '0–5 años'],
    [6, '6–10 años'],
    [10, '6–10 años'],
    [11, 'Más de 10 años'],
  ])('places a degenerate estimate(%i, %i) in "%s"', (years, label) => {
    expect(classifyAgeBand({ type: 'estimate', minYears: years, maxYears: years })).toEqual({
      kind: 'known',
      label,
    });
  });
});

describe('classifyAgeBand — ranges fully inside one band', () => {
  it('places 2–4 (estimate) inside 0–5 años', () => {
    expect(classifyAgeBand({ type: 'estimate', minYears: 2, maxYears: 4 })).toEqual({
      kind: 'known',
      label: '0–5 años',
    });
  });

  it('places 7–9 (range) inside 6–10 años', () => {
    expect(classifyAgeBand({ type: 'range', minYears: 7, maxYears: 9 })).toEqual({
      kind: 'known',
      label: '6–10 años',
    });
  });

  it('places 12–20 (range) inside Más de 10 años', () => {
    expect(classifyAgeBand({ type: 'range', minYears: 12, maxYears: 20 })).toEqual({
      kind: 'known',
      label: 'Más de 10 años',
    });
  });
});

describe('classifyAgeBand — ranges straddling a boundary are never rounded into a band', () => {
  it.each([
    ['estimate', 4, 7] as const,
    ['estimate', 5, 6] as const,
    ['range', 8, 12] as const,
    ['range', 10, 11] as const,
    ['estimate', 0, 40] as const,
  ])('marks %s(%i, %i) indeterminate rather than guessing a band', (type, minYears, maxYears) => {
    const age: ApproximateAge = { type, minYears, maxYears };
    expect(classifyAgeBand(age)).toEqual({ kind: 'indeterminate' });
  });
});

describe('classifyAgeBand — non-numeric and absent ages', () => {
  it('never parses a qualitative label into a number; it is indeterminate, not unknown', () => {
    expect(classifyAgeBand({ type: 'qualitative', label: 'bastante viejo' })).toEqual({
      kind: 'indeterminate',
    });
    expect(AGE_BAND_INDETERMINATE_LABEL).toBe('Rango/indeterminado');
  });

  it('classifies a genuinely unrecorded age as unknown, distinct from indeterminate', () => {
    expect(classifyAgeBand({ type: 'unknown' })).toEqual({ kind: 'unknown' });
    expect(AGE_BAND_UNKNOWN_LABEL).toBe('Sin dato');
  });
});
