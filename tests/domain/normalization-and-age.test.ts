import { describe, expect, it } from 'vitest';
import { deriveInstallationEstimate, normalizeModality } from '@/domain';

describe('domain normalization', () => {
  it('normalizes MRI to MR without turning unknown input into a guess', () => {
    expect(normalizeModality('MRI')).toBe('MR');
    expect(normalizeModality('Unknown')).toBe('Unknown');
    expect(normalizeModality('ambiguous scanner')).toBe('Unknown');
  });
});

describe('installation derivation', () => {
  it('derives approximately 2019 from age 7 observed in 2026 and marks it derived', () => {
    expect(
      deriveInstallationEstimate(
        { type: 'estimate', minYears: 7, maxYears: 7 },
        '2026-06-01T00:00:00.000Z',
      ),
    ).toEqual({
      type: 'year',
      year: 2019,
      origin: 'Derived',
      precision: 'Estimated',
      basedOnObservedAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('does not assign a numeric year to qualitative age', () => {
    expect(
      deriveInstallationEstimate({ type: 'qualitative', label: 'newer' }, '2026-01-01T00:00:00Z'),
    ).toEqual({ type: 'unknown', origin: 'Unknown' });
  });
});
