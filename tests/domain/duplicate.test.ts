import { describe, expect, it } from 'vitest';
import { DuplicateDetectionService, type DuplicateComparableObservation } from '@/domain';

const base: DuplicateComparableObservation = {
  id: 'a',
  customerId: 'hospital-1',
  modality: 'MR',
  manufacturer: 'NovaMed',
  model: 'X',
  approximateAge: { type: 'estimate', minYears: 7, maxYears: 8 },
  observerId: 'observer-a',
  visitId: 'visit-a',
};

describe('DuplicateDetectionService', () => {
  it('scores matching customer, modality, manufacturer, model and compatible age highly', () => {
    const result = new DuplicateDetectionService().score(base, {
      ...base,
      id: 'b',
      approximateAge: { type: 'estimate', minYears: 8, maxYears: 8 },
      observerId: 'observer-b',
      visitId: 'visit-b',
    });
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.isCandidate).toBe(true);
    expect(result.relationship).toBe('PossibleCorroboration');
    expect(result.reasons.map((reason) => reason.code)).toContain('SAME_MODEL');
  });

  it('uses modality as a hard gate even at the same hospital', () => {
    const result = new DuplicateDetectionService().score(base, {
      ...base,
      id: 'ct',
      modality: 'CT',
    });
    expect(result.score).toBe(0);
    expect(result.isCandidate).toBe(false);
    expect(result.relationship).toBe('NoMatch');
  });
});
