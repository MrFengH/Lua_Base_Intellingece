import type { ApproximateAge } from '../model';

/**
 * A purely descriptive bucket over `ApproximateAge` years — not a freshness/obsolescence policy.
 * See docs/DECISIONS.md decision 8 and its 2026-09-10 amendment: no clinical or commercial
 * threshold is implied by these boundaries, only a reporting distribution. Change the boundaries
 * here, not in the renderer, if a product owner ever supplies different ones.
 */
export interface AgeBand {
  readonly min: number;
  readonly max: number | null;
  readonly label: string;
}

export const AGE_BANDS: readonly AgeBand[] = [
  { min: 0, max: 5, label: '0–5 años' },
  { min: 6, max: 10, label: '6–10 años' },
  { min: 11, max: null, label: 'Más de 10 años' },
];

/** No `ApproximateAge` was ever recorded (`type: 'unknown'`). */
export const AGE_BAND_UNKNOWN_LABEL = 'Sin dato';

/** An age is on record but cannot be placed in one band without fabricating precision: a
 * qualitative label, or a numeric range that straddles two configured bands. */
export const AGE_BAND_INDETERMINATE_LABEL = 'Rango/indeterminado';

/** The band labels in display order, including the two non-numeric buckets above. */
export const AGE_BAND_LABELS: readonly string[] = [
  ...AGE_BANDS.map((band) => band.label),
  AGE_BAND_INDETERMINATE_LABEL,
  AGE_BAND_UNKNOWN_LABEL,
];

export type AgeBandClassification =
  | { kind: 'known'; label: string }
  | { kind: 'indeterminate' }
  | { kind: 'unknown' };

const bandFor = (years: number): AgeBand | undefined =>
  AGE_BANDS.find((band) => years >= band.min && (band.max === null || years <= band.max));

/**
 * Classifies a structured `ApproximateAge` into one of the configured bands. Never parses a raw
 * text label; a `qualitative` age is honestly indeterminate rather than guessed at.
 *
 * A `range`/`estimate` whose bounds fall in different bands is `indeterminate` rather than
 * assigned to either one — the source data does not carry enough precision to say which, and
 * rounding to an endpoint would fabricate certainty the observer never reported.
 */
export const classifyAgeBand = (age: ApproximateAge): AgeBandClassification => {
  switch (age.type) {
    case 'exact': {
      const band = bandFor(age.years);
      return band ? { kind: 'known', label: band.label } : { kind: 'indeterminate' };
    }
    case 'estimate':
    case 'range': {
      if (age.minYears === age.maxYears) {
        const band = bandFor(age.minYears);
        return band ? { kind: 'known', label: band.label } : { kind: 'indeterminate' };
      }
      const minBand = bandFor(age.minYears);
      const maxBand = bandFor(age.maxYears);
      return minBand && maxBand && minBand.label === maxBand.label
        ? { kind: 'known', label: minBand.label }
        : { kind: 'indeterminate' };
    }
    case 'qualitative':
      return { kind: 'indeterminate' };
    case 'unknown':
      return { kind: 'unknown' };
  }
};
