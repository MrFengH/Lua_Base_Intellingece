import { describe, expect, it } from 'vitest';
import { deriveInstallationEstimate, MODALITIES, normalizeModality } from '@/domain';

describe('domain normalization', () => {
  it('normalizes MRI to MR without turning unknown input into a guess', () => {
    expect(normalizeModality('MRI')).toBe('MR');
    expect(normalizeModality('Unknown')).toBe('Unknown');
    expect(normalizeModality('ambiguous scanner')).toBe('Unknown');
  });

  it('carries the six official modality values plus Unknown', () => {
    expect(MODALITIES).toEqual([
      'MR',
      'CT',
      'Ultrasound',
      'X-Ray',
      'Patient Monitoring',
      'Image Guided Therapy',
      'Unknown',
    ]);
  });

  it.each([
    'Image Guided Therapy',
    'image guided therapy',
    'image-guided therapy',
    'igt',
    'IGT',
    'terapia guiada por imagen',
    'Terapia Guiada por Imagen',
  ])('normalizes "%s" to Image Guided Therapy', (value) => {
    expect(normalizeModality(value)).toBe('Image Guided Therapy');
  });

  it.each(['image therapy', 'guided therapy', 'igtx', 'scanner', ''])(
    'still returns Unknown for the unrecognised value "%s"',
    (value) => {
      expect(normalizeModality(value)).toBe('Unknown');
    },
  );

  it('round-trips every official modality value through normalization', () => {
    for (const modality of MODALITIES) {
      expect(normalizeModality(modality)).toBe(modality);
    }
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
