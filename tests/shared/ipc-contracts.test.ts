import { describe, expect, it } from 'vitest';
import { DuplicateResolutionRequestSchema, TranscribeVoiceRequestSchema } from '@/shared';

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

describe('voice transcription IPC contract', () => {
  it('accepts a raw audio byte buffer', () => {
    const audio = new Uint8Array([1, 2, 3]);
    expect(TranscribeVoiceRequestSchema.parse({ audio })).toEqual({ audio });
  });

  it('rejects a payload with no audio, or audio that is not a byte buffer', () => {
    expect(() => TranscribeVoiceRequestSchema.parse({})).toThrow();
    expect(() => TranscribeVoiceRequestSchema.parse({ audio: 'not-bytes' })).toThrow();
    expect(() => TranscribeVoiceRequestSchema.parse({ audio: [1, 2, 3] })).toThrow();
  });

  it('rejects unknown extra fields, like every other IPC request schema', () => {
    expect(() =>
      TranscribeVoiceRequestSchema.parse({ audio: new Uint8Array([1]), extra: 'field' }),
    ).toThrow();
  });
});
