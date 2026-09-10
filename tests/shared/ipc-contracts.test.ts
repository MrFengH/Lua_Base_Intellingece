import { describe, expect, it } from 'vitest';
import { DuplicateResolutionRequestSchema } from '@/shared';

describe('duplicate resolution IPC contract (P3-S5)', () => {
  it.each(['NotDuplicate', 'SameEquipment', 'CorroboratingEvidence'] as const)(
    'accepts the authorized human resolution %s',
    (resolution) => {
      expect(
        DuplicateResolutionRequestSchema.parse({ candidateId: 'candidate-1', resolution }),
      ).toEqual({ candidateId: 'candidate-1', resolution });
    },
  );

  it('rejects Unresolved and vocabulary outside the domain as human decisions', () => {
    expect(() =>
      DuplicateResolutionRequestSchema.parse({
        candidateId: 'candidate-1',
        resolution: 'Unresolved',
      }),
    ).toThrow();
    expect(() =>
      DuplicateResolutionRequestSchema.parse({
        candidateId: 'candidate-1',
        resolution: 'Dismissed',
      }),
    ).toThrow();
  });
});
