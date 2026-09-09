import { describe, expect, it } from 'vitest';
import {
  declaredUnknownField,
  FollowUpQuestionService,
  knownField,
  missingField,
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
    },
  ],
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
