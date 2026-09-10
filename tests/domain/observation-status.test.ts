import { describe, expect, it } from 'vitest';
import {
  classifyObservationBasis,
  classifyObservationBasisAnswer,
  classifyReviewConfirmationReply,
  declaredUnknownField,
  deriveObservationStatus,
  knownField,
  missingField,
  type ApproximateAge,
  type ObservationBasis,
} from '@/domain';

const unknownAge: ApproximateAge = { type: 'unknown' };
const uncertainAge: ApproximateAge = { type: 'estimate', minYears: 7, maxYears: 7 };
const exactAge: ApproximateAge = { type: 'exact', years: 7 };

describe('classifyObservationBasis', () => {
  it.each([
    ['Vi directamente dos MR NovaMed.', 'DirectObservation'],
    ['Los vi con mis propios ojos.', 'DirectObservation'],
    ['I saw them myself in the imaging wing.', 'DirectObservation'],
    ['El técnico me dijo que tienen dos MR.', 'ReportedByOther'],
    ['Según el jefe de servicio hay tres tomógrafos.', 'ReportedByOther'],
    ['The radiographer told me they have two MR systems.', 'ReportedByOther'],
    ['Creo que tienen alrededor de dos MR.', 'Estimate'],
    ['Supongo que hay unos tres ecógrafos.', 'Estimate'],
    ['I think they have about two MR systems.', 'Estimate'],
  ] as ReadonlyArray<readonly [string, ObservationBasis]>)('reads %s as %s', (text, expected) => {
    expect(classifyObservationBasis(text)).toBe(expected);
  });

  it.each([
    'Estuve en el Hospital DemoCare Pacific ayer.',
    'They have two MR systems and one CT.',
    'Un tomógrafo, no vi la marca.',
    'No lo vi.',
  ])('leaves %s unresolved rather than guessing a source', (text) => {
    expect(classifyObservationBasis(text)).toBeNull();
  });

  it('treats a hedged retelling as reported rather than as an estimate', () => {
    expect(classifyObservationBasis('Creo que el técnico me dijo que eran dos.')).toBe(
      'ReportedByOther',
    );
  });
});

describe('classifyObservationBasisAnswer', () => {
  it.each([
    ['directamente', 'DirectObservation'],
    ['Directly', 'DirectObservation'],
    ['reported', 'ReportedByOther'],
    ['me lo reportaron', 'ReportedByOther'],
    ['es una estimación', 'Estimate'],
    ['an estimate', 'Estimate'],
  ] as ReadonlyArray<readonly [string, ObservationBasis]>)(
    'accepts the short answer %s as %s',
    (text, expected) => {
      expect(classifyObservationBasisAnswer(text)).toBe(expected);
    },
  );

  it('returns null for an answer that does not settle the source', () => {
    expect(classifyObservationBasisAnswer('mmm, depende')).toBeNull();
  });
});

describe('deriveObservationStatus', () => {
  it('maps a stated basis onto the four official statuses', () => {
    expect(
      deriveObservationStatus(knownField<ObservationBasis>('DirectObservation'), exactAge),
    ).toBe('Confirmed');
    expect(deriveObservationStatus(knownField<ObservationBasis>('ReportedByOther'), exactAge)).toBe(
      'Reported',
    );
    expect(deriveObservationStatus(knownField<ObservationBasis>('Estimate'), exactAge)).toBe(
      'Estimated',
    );
    expect(deriveObservationStatus(declaredUnknownField<ObservationBasis>(), exactAge)).toBe(
      'Unknown',
    );
  });

  it('keeps a directly observed system Confirmed even when its age is only an estimate', () => {
    expect(
      deriveObservationStatus(knownField<ObservationBasis>('DirectObservation'), uncertainAge),
    ).toBe('Confirmed');
  });

  it('keeps a reported system Reported even when its age is exact', () => {
    expect(deriveObservationStatus(knownField<ObservationBasis>('ReportedByOther'), exactAge)).toBe(
      'Reported',
    );
  });

  it('falls back to the age-derived rule only when the source was never stated', () => {
    expect(deriveObservationStatus(missingField<ObservationBasis>(), uncertainAge)).toBe(
      'Estimated',
    );
    expect(deriveObservationStatus(missingField<ObservationBasis>(), exactAge)).toBe('Reported');
    expect(deriveObservationStatus(missingField<ObservationBasis>(), unknownAge)).toBe('Reported');
  });
});

describe('classifyReviewConfirmationReply', () => {
  it.each([
    'sí',
    'si',
    'correcto',
    'así es',
    'yes',
    "that's correct",
    'confirmo',
    'sí, es correcto',
  ])('treats %s as a confirmation', (reply) => {
    expect(classifyReviewConfirmationReply(reply)).toBe('Confirm');
  });

  it.each(['no', 'no es correcto', 'incorrecto', 'that is wrong'])(
    'treats %s as a rejection',
    (reply) => {
      expect(classifyReviewConfirmationReply(reply)).toBe('Reject');
    },
  );

  it.each(['sí, pero eran tres', 'en realidad eran tres', 'la marca es Orion Imaging'])(
    'treats %s as neither, so it is handled as a correction',
    (reply) => {
      expect(classifyReviewConfirmationReply(reply)).toBe('Unrelated');
    },
  );
});
