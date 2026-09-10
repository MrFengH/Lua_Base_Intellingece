import type {
  CaptureDraft,
  CaptureEquipmentDraft,
  DraftField,
  FieldContradiction,
  FollowUpQuestion,
} from '../model';
import { contradictionQuestionText } from '../rules/contradiction';

const isMissing = <T>(field: DraftField<T>): boolean => field.state === 'Missing';

const equipmentLabel = (equipment: CaptureEquipmentDraft): string =>
  equipment.modality.state === 'Known'
    ? equipment.modality.value
    : `grupo de equipos ${equipment.order + 1}`;

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

/**
 * The provenance question is asked at most once per session. It is `Preferred`, never
 * `Required`: the official sheet marks status derived, and declining must stay acceptable.
 */
export const OBSERVATION_BASIS_QUESTION_KEY = 'equipment:collection:ObservationBasis';

/**
 * A contradiction question names both claims and asks which to keep. Its key carries the later
 * value so a second disagreement about the same field is a new question rather than a silent
 * repeat of the first.
 */
const contradictionQuestion = (
  equipment: CaptureEquipmentDraft,
  contradiction: FieldContradiction,
): FollowUpQuestion => ({
  key: `equipment:${equipment.id}:contradiction:${contradiction.field}:${contradiction.currentText}`,
  field: contradiction.field,
  priority: 'Required',
  target: { type: 'Equipment', equipmentGroupId: equipment.id },
  text: contradictionQuestionText(contradiction, equipmentLabel(equipment)),
});

/** Picks exactly one highest-value missing field; DeclaredUnknown fields are never candidates. */
export class FollowUpQuestionService {
  next(draft: CaptureDraft): FollowUpQuestion | null {
    // An unresolved disagreement outranks every gap: the draft already holds a claim that the
    // observer contradicted, and no later answer makes that go away on its own.
    for (const equipment of draft.equipment) {
      const contradiction = equipment.contradictions[0];
      if (contradiction) return contradictionQuestion(equipment, contradiction);
    }

    if (isMissing(draft.customer.name)) {
      return {
        key: 'customer:name',
        field: 'CustomerName',
        priority: 'Required',
        target: { type: 'Customer' },
        text: '¿Qué hospital o clínica visitó?',
      };
    }

    if (isMissing(draft.customer.city) || isMissing(draft.customer.country)) {
      return {
        key: 'customer:location',
        field: 'Location',
        priority: 'Required',
        target: { type: 'Customer' },
        text: '¿En qué ciudad y país se encuentra?',
      };
    }

    if (draft.equipment.length === 0) {
      return {
        key: 'equipment:collection:Modality',
        field: 'Modality',
        priority: 'Required',
        target: { type: 'EquipmentCollection' },
        text: '¿Qué tipo de equipo médico observó?',
      };
    }

    for (const equipment of draft.equipment) {
      if (isMissing(equipment.modality)) {
        return equipmentQuestion(
          equipment,
          'Modality',
          'Required',
          `¿Cuál es la modalidad de ${equipmentLabel(equipment)}?`,
        );
      }
      if (isMissing(equipment.quantity)) {
        return equipmentQuestion(
          equipment,
          'Quantity',
          'Required',
          `¿Cuántos equipos de ${equipmentLabel(equipment)} observó?`,
        );
      }
    }

    for (const equipment of draft.equipment) {
      if (isMissing(equipment.manufacturer)) {
        return equipmentQuestion(
          equipment,
          'Manufacturer',
          'Preferred',
          `¿Conoce el fabricante de los equipos de ${equipmentLabel(equipment)}?`,
        );
      }
      if (isMissing(equipment.approximateAge)) {
        return equipmentQuestion(
          equipment,
          'ApproximateAge',
          'Preferred',
          `¿Conoce la antigüedad aproximada de los equipos de ${equipmentLabel(equipment)}?`,
        );
      }
    }

    if (
      isMissing(draft.observationBasis) &&
      !draft.askedQuestionKeys.includes(OBSERVATION_BASIS_QUESTION_KEY)
    ) {
      return {
        key: OBSERVATION_BASIS_QUESTION_KEY,
        field: 'ObservationBasis',
        priority: 'Preferred',
        target: { type: 'EquipmentCollection' },
        text: '¿Observó este equipo directamente, se lo reportó otra persona, o es una estimación?',
      };
    }

    for (const equipment of draft.equipment) {
      if (isMissing(equipment.model)) {
        return equipmentQuestion(
          equipment,
          'Model',
          'Optional',
          `¿Conoce el modelo de los equipos de ${equipmentLabel(equipment)}?`,
        );
      }
      if (isMissing(equipment.notes)) {
        return equipmentQuestion(
          equipment,
          'Notes',
          'Optional',
          `¿Desea agregar notas para los equipos de ${equipmentLabel(equipment)}?`,
        );
      }
    }

    return null;
  }
}
