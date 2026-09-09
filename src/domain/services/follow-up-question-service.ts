import type { CaptureDraft, CaptureEquipmentDraft, DraftField, FollowUpQuestion } from '../model';

const isMissing = <T>(field: DraftField<T>): boolean => field.state === 'Missing';

const equipmentLabel = (equipment: CaptureEquipmentDraft): string =>
  equipment.modality.state === 'Known'
    ? equipment.modality.value
    : `equipment group ${equipment.order + 1}`;

const equipmentQuestion = (
  equipment: CaptureEquipmentDraft,
  field: FollowUpQuestion['field'],
  priority: FollowUpQuestion['priority'],
  text: string,
): FollowUpQuestion => ({
  key: `equipment:${equipment.id}:${field}`,
  field,
  priority,
  target: { type: 'Equipment', equipmentGroupId: equipment.id },
  text,
});

/** Picks exactly one highest-value missing field; DeclaredUnknown fields are never candidates. */
export class FollowUpQuestionService {
  next(draft: CaptureDraft): FollowUpQuestion | null {
    if (isMissing(draft.customer.name)) {
      return {
        key: 'customer:name',
        field: 'CustomerName',
        priority: 'Required',
        target: { type: 'Customer' },
        text: 'What hospital or clinic did you visit?',
      };
    }

    if (isMissing(draft.customer.city) || isMissing(draft.customer.country)) {
      return {
        key: 'customer:location',
        field: 'Location',
        priority: 'Required',
        target: { type: 'Customer' },
        text: 'What city and country is it located in?',
      };
    }

    if (draft.equipment.length === 0) {
      return {
        key: 'equipment:collection:Modality',
        field: 'Modality',
        priority: 'Required',
        target: { type: 'EquipmentCollection' },
        text: 'What type of medical equipment did you observe?',
      };
    }

    for (const equipment of draft.equipment) {
      if (isMissing(equipment.modality)) {
        return equipmentQuestion(
          equipment,
          'Modality',
          'Required',
          `What is the modality of ${equipmentLabel(equipment)}?`,
        );
      }
      if (isMissing(equipment.quantity)) {
        return equipmentQuestion(
          equipment,
          'Quantity',
          'Required',
          `How many ${equipmentLabel(equipment)} systems did you observe?`,
        );
      }
    }

    for (const equipment of draft.equipment) {
      if (isMissing(equipment.manufacturer)) {
        return equipmentQuestion(
          equipment,
          'Manufacturer',
          'Preferred',
          `Do you know the manufacturer of the ${equipmentLabel(equipment)} systems?`,
        );
      }
      if (isMissing(equipment.approximateAge)) {
        return equipmentQuestion(
          equipment,
          'ApproximateAge',
          'Preferred',
          `Do you know the approximate age of the ${equipmentLabel(equipment)} systems?`,
        );
      }
    }

    for (const equipment of draft.equipment) {
      if (isMissing(equipment.model)) {
        return equipmentQuestion(
          equipment,
          'Model',
          'Optional',
          `Do you know the model of the ${equipmentLabel(equipment)} systems?`,
        );
      }
      if (isMissing(equipment.notes)) {
        return equipmentQuestion(
          equipment,
          'Notes',
          'Optional',
          `Would you like to add notes for the ${equipmentLabel(equipment)} systems?`,
        );
      }
    }

    return null;
  }
}
