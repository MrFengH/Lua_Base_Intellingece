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
    ? `${format(field.value)} (incierto)`
    : format(field.value);
};

const groupText = (equipment: CaptureEquipmentDraft): string => {
  const quantity = fieldText(
    equipment.quantity,
    (value) => String(value),
    'una cantidad desconocida de',
    'algunos',
  );
  const modality = fieldText(
    equipment.modality,
    (value) => value,
    'modalidad desconocida',
    'modalidad desconocida',
  );
  const manufacturer = fieldText(
    equipment.manufacturer,
    (value) => value,
    'marca desconocida',
    'marca no indicada',
  );
  const age = fieldText(
    equipment.approximateAge,
    ageText,
    'antigüedad desconocida',
    'antigüedad no indicada',
  );
  return `${quantity} ${modality}, ${manufacturer}, ${age}`;
};

const facilityText = (draft: CaptureDraft): string => {
  const name = fieldText(
    draft.customer.name,
    (value) => value,
    'una instalación sin nombre',
    'una instalación',
  );
  const city = fieldText(
    draft.customer.city,
    (value) => value,
    'ciudad desconocida',
    'ciudad desconocida',
  );
  const country = fieldText(
    draft.customer.country,
    (value) => value,
    'país desconocido',
    'país desconocido',
  );
  return `${name}, ${city}, ${country}`;
};

const BASIS_TEXT = {
  DirectObservation: 'Usted vio este equipo directamente.',
  ReportedByOther: 'Esto le fue reportado por otra persona.',
  Estimate: 'Esto es una estimación suya.',
} as const;

const basisText = (draft: CaptureDraft): string | null => {
  if (draft.observationBasis.state === 'Known') return BASIS_TEXT[draft.observationBasis.value];
  if (draft.observationBasis.state === 'DeclaredUnknown')
    return 'La forma en que se observó esto quedó sin especificar.';
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
    const equipment = groups.length > 0 ? groups.join('; ') : 'sin equipos todavía';
    const basis = basisText(draft);
    const sentences = [
      `Registré ${facilityText(draft)}: ${equipment}.`,
      ...(basis === null ? [] : [basis]),
      '¿Es correcto?',
    ];
    return sentences.join(' ');
  }
}
