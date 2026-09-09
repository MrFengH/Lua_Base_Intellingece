import type { ApproximateAge, InstallationEstimate } from '../model';

const observationYear = (observedAt: string): number | null => {
  const date = new Date(observedAt);
  return Number.isNaN(date.valueOf()) ? null : date.getUTCFullYear();
};

export const deriveInstallationEstimate = (
  age: ApproximateAge,
  observedAt: string,
): InstallationEstimate => {
  const year = observationYear(observedAt);
  if (year === null || age.type === 'unknown' || age.type === 'qualitative') {
    return { type: 'unknown', origin: 'Unknown' };
  }

  if (age.type === 'exact') {
    return {
      type: 'year',
      year: year - age.years,
      origin: 'Derived',
      precision: 'Estimated',
      basedOnObservedAt: observedAt,
    };
  }

  if (age.minYears === age.maxYears) {
    return {
      type: 'year',
      year: year - age.minYears,
      origin: 'Derived',
      precision: 'Estimated',
      basedOnObservedAt: observedAt,
    };
  }

  return {
    type: 'range',
    minYear: year - age.maxYears,
    maxYear: year - age.minYears,
    origin: 'Derived',
    precision: 'Estimated',
    basedOnObservedAt: observedAt,
  };
};
