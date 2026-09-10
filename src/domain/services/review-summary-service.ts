import type { CaptureDraft, CaptureEquipmentDraft, DraftField } from '../model/capture';
import { describeApproximateAge } from '../rules/contradiction';

const ageText = describeApproximateAge;

const fieldText = <T>(
  field: DraftField<T>,
  format: (value: T) => string,
  unknownLabel: string,
  missingLabel: string,
): string => {
  if (field.state === 'DeclaredUnknown') return unknownLabel;
  if (field.state === 'Missing') return missingLabel;
  return field.certainty === 'Uncertain'
    ? `${format(field.value)} (uncertain)`
    : format(field.value);
};

const groupText = (equipment: CaptureEquipmentDraft): string => {
  const quantity = fieldText(
    equipment.quantity,
    (value) => String(value),
    'an unknown number of',
    'some',
  );
  const modality = fieldText(
    equipment.modality,
    (value) => value,
    'unknown modality',
    'unknown modality',
  );
  const manufacturer = fieldText(
    equipment.manufacturer,
    (value) => value,
    'brand unknown',
    'brand not stated',
  );
  const age = fieldText(equipment.approximateAge, ageText, 'age unknown', 'age not stated');
  return `${quantity} ${modality}, ${manufacturer}, ${age}`;
};

const facilityText = (draft: CaptureDraft): string => {
  const name = fieldText(
    draft.customer.name,
    (value) => value,
    'an unnamed facility',
    'a facility',
  );
  const city = fieldText(draft.customer.city, (value) => value, 'unknown city', 'unknown city');
  const country = fieldText(
    draft.customer.country,
    (value) => value,
    'unknown country',
    'unknown country',
  );
  return `${name}, ${city}, ${country}`;
};

const BASIS_TEXT = {
  DirectObservation: 'You saw this equipment yourself.',
  ReportedByOther: 'This was reported to you by someone else.',
  Estimate: 'This is your estimate.',
} as const;

const basisText = (draft: CaptureDraft): string | null => {
  if (draft.observationBasis.state === 'Known') return BASIS_TEXT[draft.observationBasis.value];
  if (draft.observationBasis.state === 'DeclaredUnknown')
    return 'How this was observed was left unknown.';
  return null;
};

/**
 * Builds the agent's closing summary from the draft alone. It is deterministic on purpose: the
 * one step whose job is verification must not depend on a second inference call, which would add
 * latency, a failure mode and a fabrication risk to the moment the observer is asked to trust it.
 */
export class ReviewSummaryService {
  summarize(draft: CaptureDraft): string {
    const groups = draft.equipment.map(groupText);
    const equipment = groups.length > 0 ? groups.join('; ') : 'no equipment yet';
    const basis = basisText(draft);
    const sentences = [
      `I captured ${facilityText(draft)}: ${equipment}.`,
      ...(basis === null ? [] : [basis]),
      'Is that correct?',
    ];
    return sentences.join(' ');
  }
}
