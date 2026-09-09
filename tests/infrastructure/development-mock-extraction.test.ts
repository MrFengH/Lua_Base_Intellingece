import { describe, expect, it } from 'vitest';
import { DevelopmentMockObservationExtractionService } from '@/infrastructure';

describe('Development Mock extraction fixture', () => {
  it('splits heterogeneous MR age groups instead of assigning age nine to all three', async () => {
    const service = new DevelopmentMockObservationExtractionService();
    const result = await service.extract(
      'Three MR systems. Two are around nine years old and one around three.',
      {
        captureDraft: null,
        pendingQuestion: null,
        conversation: [],
        knownCustomers: [],
      },
    );
    expect(result.equipment).toHaveLength(2);
    expect(result.equipment.map((item) => item.quantity)).toEqual([2, 1]);
    expect(result.equipment.map((item) => item.approximateAge)).toEqual([
      { type: 'estimate', minYears: 9, maxYears: 9 },
      { type: 'estimate', minYears: 3, maxYears: 3 },
    ]);
  });
});
