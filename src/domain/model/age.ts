import type { FieldOrigin } from './enums';

export type ApproximateAge =
  | { type: 'exact'; years: number }
  | { type: 'estimate'; minYears: number; maxYears: number }
  | { type: 'range'; minYears: number; maxYears: number }
  | { type: 'qualitative'; label: string }
  | { type: 'unknown' };

export type InstallationEstimate =
  | {
      type: 'year';
      year: number;
      origin: FieldOrigin;
      precision: 'Exact' | 'Estimated';
      basedOnObservedAt?: string;
    }
  | {
      type: 'range';
      minYear: number;
      maxYear: number;
      origin: FieldOrigin;
      precision: 'Estimated';
      basedOnObservedAt?: string;
    }
  | { type: 'unknown'; origin: 'Unknown' };

export interface NumericInterval {
  min: number;
  max: number;
}
