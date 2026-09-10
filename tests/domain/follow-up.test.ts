import { describe, expect, it } from 'vitest';
import {
  declaredUnknownField,
  FollowUpQuestionService,
  knownField,
  missingField,
  OBSERVATION_BASIS_QUESTION_KEY,
  type CaptureDraft,
} from '@/domain';

const draft = (): CaptureDraft => ({
  id: 'capture-1',
  state: 'NEEDS_FOLLOW_UP',
  source: 'Text',
  customer: {
    name: knownField('Hospital DemoCare Pacific'),
    city: knownField('Panama City'),
    country: knownField('Panama'),
  },
  equipment: [
    {
      id: 'mr-group',
      order: 0,
      modality: knownField('MR'),
      rawModality: 'MR',
      quantity: knownField(2),
      manufacturer: missingField(),
      model: missingField(),
      approximateAge: missingField(),
      notes: missingField(),
      contradictions: [],
    },
  ],
  observationBasis: knownField('DirectObservation'),
  askedQuestionKeys: [],
});

describe('FollowUpQuestionService', () => {
  it('asks for brand before age when required fields are known', () => {
    const question = new FollowUpQuestionService().next(draft());
    expect(question?.field).toBe('Manufacturer');
    expect(question?.target).toEqual({ type: 'Equipment', equipmentGroupId: 'mr-group' });
  });

  it('never asks a model again after it was declared unknown', () => {
    const value = draft();
    const equipment = value.equipment[0]!;
    const completed: CaptureDraft = {
      ...value,
      equipment: [
        {
          ...equipment,
          manufacturer: knownField('NovaMed'),
          approximateAge: knownField({ type: 'exact', years: 5 }),
          model: declaredUnknownField(['evidence-unknown']),
          notes: declaredUnknownField(['evidence-unknown']),
        },
      ],
    };
    expect(new FollowUpQuestionService().next(completed)).toBeNull();
  });
});

describe('FollowUpQuestionService observation basis question (P3-S3)', () => {
  const withoutBasis = (): CaptureDraft => {
    const value = draft();
    const equipment = value.equipment[0]!;
    return {
      ...value,
      observationBasis: missingField(),
      equipment: [
        {
          ...equipment,
          manufacturer: knownField('NovaMed'),
          approximateAge: knownField({ type: 'exact', years: 5 }),
        },
      ],
    };
  };

  it('asks how the equipment was observed after the preferred field questions', () => {
    const question = new FollowUpQuestionService().next(withoutBasis());
    expect(question?.field).toBe('ObservationBasis');
    expect(question?.priority).toBe('Preferred');
    expect(question?.target).toEqual({ type: 'EquipmentCollection' });
  });

  it('does not ask before the required and preferred field questions are settled', () => {
    const question = new FollowUpQuestionService().next({
      ...draft(),
      observationBasis: missingField(),
    });
    expect(question?.field).toBe('Manufacturer');
  });

  it('never asks the question twice in one session', () => {
    const asked: CaptureDraft = {
      ...withoutBasis(),
      askedQuestionKeys: [OBSERVATION_BASIS_QUESTION_KEY],
    };
    expect(new FollowUpQuestionService().next(asked)?.field).not.toBe('ObservationBasis');
  });

  it('never asks again once the source was declared unknown', () => {
    const declined: CaptureDraft = {
      ...withoutBasis(),
      observationBasis: declaredUnknownField(['evidence-unknown']),
    };
    expect(new FollowUpQuestionService().next(declined)?.field).not.toBe('ObservationBasis');
  });

  it('phrases the question in plain language without exposing internal values', () => {
    const text = new FollowUpQuestionService().next(withoutBasis())?.text ?? '';
    expect(text).toMatch(/observe/i);
    expect(text).toMatch(/reported/i);
    expect(text).toMatch(/estimate/i);
    expect(text).not.toMatch(/DirectObservation|ReportedByOther|Confirmed|Estimated/);
  });
});
