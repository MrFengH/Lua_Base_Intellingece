import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CaptureCorrection,
  CaptureSessionView,
  ConversationMessage,
  Customer360View,
  CustomerListItem,
  DashboardView,
  DuplicateCandidateReview,
  DuplicateReviewObservation,
  InferenceRuntimeInfo,
  InstalledBaseItem,
  ObservationEvidenceEntryView,
  ObservationEvidenceView,
} from '@/application/contracts';
import { CONFIDENCE_LEVELS, MODALITIES, OBSERVATION_STATUSES } from '@/domain/model';
import { contradictionFieldLabel } from '@/domain/rules';
import type {
  ApproximateAge,
  CaptureState,
  ConfidenceAssessment,
  ConfidenceReasonCode,
  DraftField,
  DuplicateReasonCode,
  DuplicateResolution,
  EvidenceRelationship,
  FactCertainty,
  FieldOrigin,
  FollowUpPriority,
  InstallationEstimate,
  KnowledgeState,
  ObservationStatus,
  ResolvedDuplicateResolution,
} from '@/domain';
import type { IpcResult } from '@/shared';
import luaLogo from '../../../assets/logo_lua.png';
import { encodeWavFromAudioBuffer } from './audio/wav-encoder';
import {
  captureSubmissionError,
  createOptimisticMessage,
  reconcileOptimisticMessages,
  type OptimisticConversationMessage,
} from './capture-message-state';
import {
  IconCheck,
  IconChart,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconFacility,
  IconFlag,
  IconInbox,
  IconLedger,
  IconMic,
  IconSend,
} from './icons';

type Page = 'capture' | 'customers' | 'dashboard';

/** Local recording/transcription state for the microphone button — never persisted, never
 * touching the capture draft directly; a finished transcript is placed into the ordinary text
 * input for the observer to review, edit, or discard like anything else they typed. */
type VoiceState = 'idle' | 'recording' | 'transcribing' | 'permission-denied' | 'error';

const unwrap = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

const fieldText = <T,>(field: DraftField<T>, format: (value: T) => string = String): string => {
  if (field.state === 'Known') return format(field.value);
  return field.state === 'DeclaredUnknown' ? 'Desconocido (declarado)' : 'No indicado';
};

const ageText = (age: ApproximateAge): string => {
  if (age.type === 'unknown') return 'Desconocida';
  if (age.type === 'qualitative') return age.label;
  if (age.type === 'exact') return `${age.years} años`;
  if (age.minYears === age.maxYears) return `~${age.minYears} años`;
  return `${age.minYears}–${age.maxYears} años`;
};

/** Human labels for the coded `ObservationStatus` enum. The enum value stays in the stored data
 * and is used for logic (e.g. CSS state classes); only the label is presentational. */
const STATUS_LABELS: Record<ObservationStatus, string> = {
  Confirmed: 'Confirmado',
  Reported: 'Reportado',
  Estimated: 'Estimado',
  Unknown: 'Desconocido',
};

/** Which chip register each observation status reads as — a stamped classification, not a
 * decorative color. */
const STATUS_CHIP_CLASS: Record<ObservationStatus, string> = {
  Confirmed: 'chip-verified',
  Reported: 'chip-info',
  Estimated: 'chip-estimated',
  Unknown: 'chip-neutral',
};

/** Answers "how did the observer come to know this", per docs/DATA_SCHEMA.md. Fixed text per
 * status value, not derived from any one record, so it never re-infers status in the renderer. */
const STATUS_EXPLANATIONS: Record<ObservationStatus, string> = {
  Confirmed: 'El observador indicó haber visto el equipo directamente.',
  Reported: 'La información fue transmitida por otra persona u otra fuente.',
  Estimated: 'El observador presentó el relato como una estimación.',
  Unknown: 'No se pudo establecer el origen de la observación.',
};

/** Human labels for the coded confidence reasons already produced by
 * SimpleConfidenceScoringService. The reason code stays in the stored data; only the label is
 * presentational. */
const CONFIDENCE_REASON_LABELS: Record<ConfidenceReasonCode, string> = {
  NO_KNOWN_FACTS: 'Ningún campo tiene un valor conocido todavía',
  EXPLICIT_FACTS: 'Algunos campos se indicaron explícitamente',
  UNCERTAINTY_LANGUAGE: 'Algunos campos eran inciertos',
  DERIVED_FACTS: 'Algunos campos fueron derivados en lugar de reportados',
  INCOMPLETE_FIELDS: 'Algunos campos siguen incompletos',
};

/** Human labels for the coded `ConfidenceLevel` enum. */
const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceAssessment['level'], string> = {
  High: 'Alta',
  Medium: 'Media',
  Low: 'Baja',
  Unknown: 'Desconocida',
};

const CONFIDENCE_CHIP_CLASS: Record<ConfidenceAssessment['level'], string> = {
  High: 'chip-verified',
  Medium: 'chip-estimated',
  Low: 'chip-caution',
  Unknown: 'chip-neutral',
};

const DUPLICATE_RELATIONSHIP_LABELS: Record<EvidenceRelationship, string> = {
  NoMatch: 'Sin coincidencia',
  PossibleDuplicate: 'Posible duplicado',
  PossibleCorroboration: 'Posible corroboración',
  PartialMatch: 'Coincidencia parcial',
  PossibleConflict: 'Posible conflicto',
};

const DUPLICATE_RELATIONSHIP_CHIP_CLASS: Record<EvidenceRelationship, string> = {
  NoMatch: 'chip-neutral',
  PossibleDuplicate: 'chip-estimated',
  PossibleCorroboration: 'chip-verified',
  PartialMatch: 'chip-estimated',
  PossibleConflict: 'chip-contradiction',
};

const DUPLICATE_REASON_LABELS: Partial<Record<DuplicateReasonCode, string>> = {
  DIFFERENT_CUSTOMER: 'Centro diferente',
  SAME_CUSTOMER: 'Mismo centro',
  UNKNOWN_MODALITY: 'Modalidad desconocida',
  DIFFERENT_MODALITY: 'Modalidad diferente',
  SAME_MODALITY: 'Misma modalidad',
  SAME_MANUFACTURER: 'Mismo fabricante',
  DIFFERENT_MANUFACTURER: 'Fabricante diferente',
  SAME_MODEL: 'Mismo modelo',
  DIFFERENT_MODEL: 'Modelo diferente',
  COMPATIBLE_AGE: 'Antigüedad aproximada compatible',
  INCOMPATIBLE_AGE: 'Antigüedad aproximada incompatible',
  INDEPENDENT_OBSERVER: 'Reportado por un observador diferente',
  INDEPENDENT_VISIT: 'Reportado durante una visita diferente',
};

const DUPLICATE_RESOLUTION_LABELS: Record<DuplicateResolution, string> = {
  Unresolved: 'Pendiente de revisión',
  NotDuplicate: 'No es duplicado',
  SameEquipment: 'Mismo equipo',
  CorroboratingEvidence: 'Evidencia corroborante',
};

const DUPLICATE_RESOLUTION_OPTIONS: ReadonlyArray<{
  value: ResolvedDuplicateResolution;
  label: string;
  description: string;
}> = [
  {
    value: 'NotDuplicate',
    label: 'No es duplicado',
    description: 'Estas observaciones no se refieren al mismo equipo.',
  },
  {
    value: 'SameEquipment',
    label: 'Mismo equipo',
    description: 'Se refieren al mismo equipo; ambos registros de evidencia permanecen intactos.',
  },
  {
    value: 'CorroboratingEvidence',
    label: 'Evidencia corroborante',
    description: 'La nueva observación respalda de forma independiente el registro existente.',
  },
];

const FIELD_LABELS: Record<string, string> = {
  modality: 'Modalidad',
  quantity: 'Cantidad',
  manufacturer: 'Fabricante',
  model: 'Modelo',
  approximateAge: 'Antigüedad aprox.',
  notes: 'Notas',
};

const KNOWLEDGE_STATE_LABELS: Record<KnowledgeState, string> = {
  Known: 'Conocido',
  DeclaredUnknown: 'Desconocido declarado',
  Missing: 'No mencionado',
};

/** Human labels for the coded `FactCertainty` enum. */
const CERTAINTY_LABELS: Record<FactCertainty, string> = {
  Explicit: 'Explícito',
  Uncertain: 'Incierto',
  Unknown: 'Desconocido',
};

/** Human labels for the coded `FieldOrigin` enum. */
const FIELD_ORIGIN_LABELS: Record<FieldOrigin, string> = {
  Observed: 'Observado',
  Reported: 'Reportado',
  Derived: 'Derivado',
  Unknown: 'Desconocido',
};

/** Human label for the coded freshness status. Only `Unknown` is produced today; see
 * docs/DATA_SCHEMA.md — no business aging thresholds have been supplied yet. */
const FRESHNESS_STATUS_LABELS: Record<'Unknown', string> = { Unknown: 'Desconocida' };

/** `null` means the extractor supplied no certainty at all, which must read differently from an
 * explicit `Unknown` classification — neither is promoted to `Explicit`. */
const certaintyText = (certainty: FactCertainty | null): string =>
  certainty === null ? 'No proporcionado' : CERTAINTY_LABELS[certainty];

/** A corrected field's evidence includes the `correction:` id the workflow service records when a
 * review edit is applied, so this reads existing provenance rather than inventing a history. */
const wasCorrected = (evidenceIds: readonly string[]): boolean =>
  evidenceIds.some((id) => id.startsWith('correction:'));

const installationText = (installation: InstallationEstimate): string => {
  if (installation.type === 'unknown') return 'Desconocida';
  if (installation.type === 'year') return `~${installation.year} (derivado)`;
  return `${installation.minYear}–${installation.maxYear} (derivado)`;
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/** Human labels for the coded `ConversationMessage.role` enum. */
const MESSAGE_ROLE_LABELS: Record<'User' | 'Assistant', string> = {
  User: 'Usted',
  Assistant: 'Asistente',
};

/** Human labels for the coded `CaptureState` enum. */
const CAPTURE_STATE_LABELS: Record<CaptureState, string> = {
  NEW: 'Nuevo',
  EXTRACTING: 'Extrayendo',
  NEEDS_FOLLOW_UP: 'Necesita seguimiento',
  READY_FOR_REVIEW: 'Listo para revisión',
  SAVED: 'Guardado',
  ERROR: 'Error',
};

const CAPTURE_STATE_CHIP_CLASS: Record<CaptureState, string> = {
  NEW: 'chip-neutral',
  EXTRACTING: 'chip-neutral',
  NEEDS_FOLLOW_UP: 'chip-estimated',
  READY_FOR_REVIEW: 'chip-info',
  SAVED: 'chip-verified',
  ERROR: 'chip-contradiction',
};

/** Human labels for the coded `FollowUpPriority` enum. */
const QUESTION_PRIORITY_LABELS: Record<FollowUpPriority, string> = {
  Required: 'obligatoria',
  Preferred: 'preferida',
  Optional: 'opcional',
};

/** The five stages the capture workflow always passes through, used to drive the pipeline
 * tracker at the top of the Capturar screen. */
const CAPTURE_STAGES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'capture', label: 'Captura' },
  { key: 'followup', label: 'Seguimiento' },
  { key: 'review', label: 'Revisión' },
  { key: 'confirm', label: 'Confirmación' },
  { key: 'save', label: 'Guardado' },
];

/** Maps the domain's `CaptureState` (plus the separate `reviewConfirmed` flag) onto the fixed
 * five-stage pipeline the UI always shows, so the tracker reads the same workflow the state
 * machine already enforces rather than a UI-only approximation of it. */
const captureStageIndex = (capture: CaptureSessionView | null): number => {
  if (!capture) return 0;
  switch (capture.draft.state) {
    case 'NEW':
    case 'EXTRACTING':
      return 0;
    case 'NEEDS_FOLLOW_UP':
      return 1;
    case 'READY_FOR_REVIEW':
      return capture.reviewConfirmed ? 3 : 2;
    case 'SAVED':
      return 4;
    case 'ERROR':
    default:
      return 0;
  }
};

interface SessionEvidenceGroup {
  sessionId: string;
  observedAt: string;
  observerName: string;
  source: string;
  rawInput: string | null;
  items: readonly ObservationEvidenceEntryView[];
  equipmentObservationIds: string[];
}

/** One evidence row per session rather than per equipment row, since a multi-equipment
 * session otherwise repeats the same raw input once for every equipment group it produced. */
const groupEvidenceBySession = (
  evidence: readonly ObservationEvidenceView[],
): SessionEvidenceGroup[] => {
  const bySession = new Map<string, SessionEvidenceGroup>();
  evidence.forEach((item) => {
    const existing = bySession.get(item.sessionId);
    if (existing) {
      existing.equipmentObservationIds.push(item.equipmentObservationId);
      return;
    }
    bySession.set(item.sessionId, {
      sessionId: item.sessionId,
      observedAt: item.observedAt,
      observerName: item.observerName,
      source: item.source,
      rawInput: item.rawInput,
      items: item.items,
      equipmentObservationIds: [item.equipmentObservationId],
    });
  });
  return [...bySession.values()];
};

/** Renders one raw evidence entry. When it answered a deterministic follow-up question, the
 * question is shown as context above the answer — it is never treated as observed evidence
 * itself, only as the reason the short answer below it makes sense. */
const EvidenceEntry = ({ item }: { item: ObservationEvidenceEntryView }): React.JSX.Element => (
  <div className="evidence-entry">
    {item.followUpQuestion && (
      <>
        <span className="evidence-entry-label">Pregunta</span>
        <p className="evidence-entry-question">{item.followUpQuestion}</p>
        <span className="evidence-entry-label">Respuesta</span>
      </>
    )}
    <p className="evidence-entry-text">{item.rawText ?? 'Evidencia sin texto'}</p>
  </div>
);

/** What each equipment observation id supports, so an evidence row can say which projection
 * it backs instead of surfacing the bare internal id as its main content. */
const equipmentLabelsById = (installedBase: readonly InstalledBaseItem[]): Map<string, string> => {
  const labels = new Map<string, string>();
  installedBase.forEach((item) => {
    const label = `${item.modality}${item.manufacturer ? ` · ${item.manufacturer}` : ''}`;
    item.contributingObservationIds.forEach((id) => labels.set(id, label));
  });
  return labels;
};

const facilityText = (observation: DuplicateReviewObservation): string =>
  [observation.facility.name, observation.facility.city, observation.facility.country]
    .filter(Boolean)
    .join(' · ');

const confidenceText = (confidence: ConfidenceAssessment): string =>
  confidence.score === null
    ? CONFIDENCE_LEVEL_LABELS[confidence.level]
    : `${CONFIDENCE_LEVEL_LABELS[confidence.level]} (${confidence.score.toFixed(2)})`;

interface DuplicateComparisonRow {
  label: string;
  source: string;
  comparable: string;
}

const duplicateComparisonRows = (
  candidate: DuplicateCandidateReview,
): readonly DuplicateComparisonRow[] => {
  const source = candidate.sourceObservation;
  const comparable = candidate.comparableObservation;
  return [
    { label: 'Centro', source: facilityText(source), comparable: facilityText(comparable) },
    { label: 'Modalidad', source: source.modality, comparable: comparable.modality },
    {
      label: 'Cantidad',
      source: source.quantity === null ? 'Desconocida' : String(source.quantity),
      comparable: comparable.quantity === null ? 'Desconocida' : String(comparable.quantity),
    },
    {
      label: 'Fabricante',
      source: source.manufacturer ?? 'Desconocido',
      comparable: comparable.manufacturer ?? 'Desconocido',
    },
    {
      label: 'Modelo',
      source: source.model ?? 'Desconocido',
      comparable: comparable.model ?? 'Desconocido',
    },
    {
      label: 'Antigüedad aprox.',
      source: ageText(source.approximateAge),
      comparable: ageText(comparable.approximateAge),
    },
    {
      label: 'Estado',
      source: STATUS_LABELS[source.status],
      comparable: STATUS_LABELS[comparable.status],
    },
    {
      label: 'Confianza',
      source: confidenceText(source.confidence),
      comparable: confidenceText(comparable.confidence),
    },
    {
      label: 'Observado / fuente',
      source: `${new Date(source.observedAt).toLocaleDateString()} · ${source.source}`,
      comparable: `${new Date(comparable.observedAt).toLocaleDateString()} · ${comparable.source}`,
    },
  ];
};

const DuplicateReviewPanel = ({
  candidate,
  candidatePosition,
  candidateCount,
  selectedResolution,
  busy,
  previous,
  next,
  chooseResolution,
  resolve,
}: {
  candidate: DuplicateCandidateReview;
  candidatePosition: number;
  candidateCount: number;
  selectedResolution: ResolvedDuplicateResolution | null;
  busy: boolean;
  previous: () => void;
  next: () => void;
  chooseResolution: (resolution: ResolvedDuplicateResolution) => void;
  resolve: () => void;
}): React.JSX.Element => {
  const comparisonRows = duplicateComparisonRows(candidate);
  const resolved = candidate.resolution !== 'Unresolved';
  return (
    <article className="duplicate-review-card">
      <div className="duplicate-review-summary">
        <div>
          <span
            className={`status-chip ${DUPLICATE_RELATIONSHIP_CHIP_CLASS[candidate.relationship]}`}
          >
            {DUPLICATE_RELATIONSHIP_LABELS[candidate.relationship]}
          </span>
        </div>
        <div className="candidate-navigation">
          <span>
            {candidatePosition + 1} de {candidateCount}
          </span>
          <button className="icon-button" onClick={previous} disabled={candidateCount < 2}>
            <IconChevronLeft />
            <span className="sr-only">Anterior</span>
          </button>
          <button className="icon-button" onClick={next} disabled={candidateCount < 2}>
            <span className="sr-only">Siguiente</span>
            <IconChevronRight />
          </button>
        </div>
      </div>

      <section className="duplicate-reasons">
        <h4>Por qué se marcó</h4>
        <ul>
          {candidate.reasons.map((reason) => (
            <li key={reason.code}>
              <span>
                {DUPLICATE_REASON_LABELS[reason.code] ??
                  (reason.detail.trim() || 'Motivo registrado por el detector')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="duplicate-comparison" aria-label="Comparación de candidato duplicado">
        <div className="duplicate-comparison-row comparison-heading">
          <span>Campo</span>
          <strong>Nueva observación</strong>
          <strong>Comparable existente</strong>
        </div>
        {comparisonRows.map((row) => {
          const differs = row.source !== row.comparable;
          return (
            <div className="duplicate-comparison-row" key={row.label}>
              <strong>{row.label}</strong>
              <span className={differs ? 'comparison-difference' : ''}>{row.source}</span>
              <span className={differs ? 'comparison-difference' : ''}>{row.comparable}</span>
            </div>
          );
        })}
      </section>

      <section className="duplicate-evidence-grid">
        {[
          { label: 'Evidencia de la nueva observación', observation: candidate.sourceObservation },
          {
            label: 'Evidencia de la observación existente',
            observation: candidate.comparableObservation,
          },
        ].map(({ label, observation }) => (
          <article key={label}>
            <strong>{label}</strong>
            <p>
              {observation.rawEvidence ??
                'No se almacenó evidencia de texto para esta observación.'}
            </p>
            <small>
              {observation.observerName} · {new Date(observation.observedAt).toLocaleDateString()} ·{' '}
              {observation.source}
            </small>
          </article>
        ))}
      </section>

      {resolved ? (
        <div className="resolution-recorded">
          <strong>Decisión humana: {DUPLICATE_RESOLUTION_LABELS[candidate.resolution]}</strong>
          <span>Ambas observaciones originales y su evidencia permanecen sin cambios.</span>
        </div>
      ) : (
        <fieldset className="duplicate-resolution">
          <legend>Registrar una decisión humana</legend>
          <p>
            Seleccione una opción y regístrela explícitamente. Esto nunca combina ni edita ninguna
            de las observaciones.
          </p>
          <div className="resolution-options">
            {DUPLICATE_RESOLUTION_OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name={`duplicate-resolution-${candidate.id}`}
                  checked={selectedResolution === option.value}
                  onChange={() => chooseResolution(option.value)}
                  disabled={busy}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
          <button
            className="primary-button"
            onClick={resolve}
            disabled={busy || selectedResolution === null}
          >
            {busy ? 'Registrando decisión…' : 'Registrar decisión humana'}
          </button>
        </fieldset>
      )}
    </article>
  );
};

/** Human labels for the coded `InferenceRuntimeInfo.engine` enum. */
const ENGINE_LABELS: Record<InferenceRuntimeInfo['engine'], string> = {
  QVAC: 'QVAC',
  'Development Mock': 'Simulador de desarrollo',
};

/** Human labels for the coded `InferenceRuntimeInfo.execution` enum. */
const EXECUTION_LABELS: Record<InferenceRuntimeInfo['execution'], string> = {
  'On-device': 'En el dispositivo',
  'Development only': 'Solo desarrollo',
};

/** Human labels for the coded `InferenceRuntimeInfo.status` enum. */
const RUNTIME_STATUS_LABELS: Record<InferenceRuntimeInfo['status'], string> = {
  'model-not-loaded': 'Modelo no cargado',
  downloading: 'Descargando',
  loading: 'Cargando',
  ready: 'Listo',
  processing: 'Procesando',
  error: 'Error',
};

/** A slim, collapsible strip rather than a prominent card: the engine's on-device status stays
 * legible at a glance without competing with the capture and review work it supports. */
const EngineStatus = ({
  runtime,
  initialize,
  busy,
}: {
  runtime: InferenceRuntimeInfo | null;
  initialize: () => void;
  busy: boolean;
}): React.JSX.Element => {
  if (!runtime)
    return <div className="engine-status skeleton">Comprobando el motor de inferencia…</div>;
  const ready = runtime.status === 'ready';
  const mock = runtime.engine === 'Development Mock';
  return (
    <details className={`engine-status ${mock ? 'mock' : ''}`}>
      <summary>
        <span className={`status-dot ${ready ? 'ready' : runtime.status}`} />
        <span className="engine-name">Motor: {ENGINE_LABELS[runtime.engine]}</span>
        <span className="engine-state">{RUNTIME_STATUS_LABELS[runtime.status]}</span>
        {mock && <span className="status-chip chip-estimated">Simulador</span>}
      </summary>
      <div className="engine-detail">
        <div className="runtime-grid">
          <span>Ejecución</span>
          <b>{EXECUTION_LABELS[runtime.execution]}</b>
          <span>Modelo</span>
          <b>{runtime.model}</b>
          <span>Red para inferencia</span>
          <b>{runtime.networkRequiredForInference ? 'Sí' : 'No'}</b>
        </div>
        {runtime.detail && <p>{runtime.detail}</p>}
        {runtime.engine === 'QVAC' && !ready && (
          <button className="small-button" onClick={initialize} disabled={busy}>
            {busy ? 'Inicializando…' : 'Inicializar modelo local'}
          </button>
        )}
        {mock && (
          <div className="mock-warning">
            Simulador de desarrollo — no válido para la demo final de QVAC
          </div>
        )}
      </div>
    </details>
  );
};

interface EquipmentEdit {
  id: string;
  modality: string;
  quantity: string;
  manufacturer: string;
  model: string;
  /** Numeric text, meaningful only while `ageKind` is 'editable'. */
  age: string;
  /**
   * 'preserved' means the current age cannot be represented as a single number without
   * fabricating one (qualitative, a range, or an estimate with different min/max) and is
   * rendered read-only. It becomes 'editable' only if the observer explicitly clears it.
   */
  ageKind: 'editable' | 'preserved';
  ageLabel: string;
  notes: string;
}

type EquipmentEditField = 'modality' | 'quantity' | 'manufacturer' | 'model' | 'age' | 'notes';

const EQUIPMENT_EDIT_FIELD_LABELS: Record<'quantity' | 'manufacturer' | 'model' | 'notes', string> =
  {
    quantity: 'cantidad',
    manufacturer: 'fabricante',
    model: 'modelo',
    notes: 'notas',
  };

interface EditState {
  customer: { name: string; city: string; country: string };
  equipment: EquipmentEdit[];
}

/** The single year a plain number input can represent without inventing precision, or `null` for
 * anything else — qualitative, a range, or an estimate whose bounds differ — which must be
 * preserved rather than edited. */
const singleAgeYears = (age: ApproximateAge): number | null => {
  if (age.type === 'exact') return age.years;
  if (age.type === 'estimate' && age.minYears === age.maxYears) return age.minYears;
  return null;
};

const editStateFromCapture = (capture: CaptureSessionView): EditState => ({
  customer: {
    name: capture.draft.customer.name.state === 'Known' ? capture.draft.customer.name.value : '',
    city: capture.draft.customer.city.state === 'Known' ? capture.draft.customer.city.value : '',
    country:
      capture.draft.customer.country.state === 'Known' ? capture.draft.customer.country.value : '',
  },
  equipment: capture.draft.equipment.map((item) => {
    const age = item.approximateAge;
    const knownAge = age.state === 'Known' ? age.value : null;
    const singleYears = knownAge ? singleAgeYears(knownAge) : null;
    return {
      id: item.id,
      modality: item.modality.state === 'Known' ? item.modality.value : '',
      quantity: item.quantity.state === 'Known' ? String(item.quantity.value) : '',
      manufacturer: item.manufacturer.state === 'Known' ? item.manufacturer.value : '',
      model: item.model.state === 'Known' ? item.model.value : '',
      age: singleYears !== null ? String(singleYears) : '',
      ageKind: knownAge !== null && singleYears === null ? 'preserved' : 'editable',
      ageLabel: knownAge ? ageText(knownAge) : '',
      notes: item.notes.state === 'Known' ? item.notes.value : '',
    };
  }),
});

const CapturePage = ({
  capture,
  optimisticMessages,
  runtime,
  busy,
  initializeRuntime,
  submit,
  review,
  confirm,
  save,
  correct,
  startNew,
}: {
  capture: CaptureSessionView | null;
  optimisticMessages: readonly ConversationMessage[];
  runtime: InferenceRuntimeInfo | null;
  busy: boolean;
  initializeRuntime: () => void;
  submit: (text: string) => boolean;
  review: () => void;
  confirm: () => void;
  save: () => void;
  correct: (correction: CaptureCorrection) => void;
  startNew: () => void;
}): React.JSX.Element => {
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editOriginal, setEditOriginal] = useState<EditState | null>(null);
  /**
   * The message count at the moment the observer declined the review summary. The confirmation
   * ask stays dismissed only while the transcript hasn't grown since — any new message (a typed
   * correction, a follow-up answer, an applied edit) means a new round is underway, so the ask
   * re-arms itself once the backend produces a fresh summary to confirm. Tracking a snapshot
   * count rather than a plain boolean means this needs no server-side "rejected" state at all.
   */
  const [reviewDismissedAt, setReviewDismissedAt] = useState<number | null>(null);
  // Adjusting state during render (React's documented pattern for resetting state when a prop
  // changes) rather than in an effect, so a brand-new capture session never carries over a
  // dismissal from the session before it.
  const [reviewDismissedForCapture, setReviewDismissedForCapture] = useState(capture?.id);
  if (capture?.id !== reviewDismissedForCapture) {
    setReviewDismissedForCapture(capture?.id);
    setReviewDismissedAt(null);
  }
  const stageIndex = captureStageIndex(capture);
  const transcriptLogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = transcriptLogRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [capture?.messages.length, optimisticMessages.length]);

  const reviewDismissed =
    reviewDismissedAt !== null && capture?.messages.length === reviewDismissedAt;

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);

  const releaseMicrophone = (): void => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  };

  const finishRecording = async (): Promise<void> => {
    setVoiceState('transcribing');
    try {
      const blob = new Blob(audioChunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || 'audio/webm',
      });
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext();
      let wavBytes: Uint8Array;
      try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        wavBytes = encodeWavFromAudioBuffer(audioBuffer);
      } finally {
        await audioContext.close();
      }
      const result = await window.installedBaseApi.transcribeVoice(wavBytes);
      if (!result.ok) throw new Error(result.error.message);
      const transcript = result.data.text.trim();
      if (transcript) {
        setInput((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript));
      }
      setVoiceState('idle');
    } catch (error) {
      setVoiceError(
        error instanceof Error ? error.message : 'No se pudo transcribir el audio grabado.',
      );
      setVoiceState('error');
    }
  };

  const startRecording = async (): Promise<void> => {
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        releaseMicrophone();
        void finishRecording();
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setVoiceState('recording');
    } catch {
      releaseMicrophone();
      setVoiceState('permission-denied');
    }
  };

  const toggleRecording = (): void => {
    if (voiceState === 'recording') {
      mediaRecorderRef.current?.stop();
      return;
    }
    void startRecording();
  };

  useEffect(() => releaseMicrophone, []);

  const send = (): void => {
    if (!input.trim()) return;
    if (submit(input.trim())) setInput('');
  };
  const beginEdit = (): void => {
    if (!capture) return;
    const state = editStateFromCapture(capture);
    setEditState(state);
    setEditOriginal(state);
    setEditing(true);
  };
  const updateEquipmentField = (id: string, field: EquipmentEditField, value: string): void => {
    setEditState((current) =>
      current
        ? {
            ...current,
            equipment: current.equipment.map((candidate) =>
              candidate.id === id ? { ...candidate, [field]: value } : candidate,
            ),
          }
        : current,
    );
  };
  /** The only way to change a preserved (non-numeric) age: an explicit clear, never an implicit
   * numeric guess. Switches the field to an editable, blank numeric input. */
  const clearPreservedAge = (id: string): void => {
    setEditState((current) =>
      current
        ? {
            ...current,
            equipment: current.equipment.map((candidate) =>
              candidate.id === id ? { ...candidate, ageKind: 'editable', age: '' } : candidate,
            ),
          }
        : current,
    );
  };
  const applyEdit = (): void => {
    if (!editState || !editOriginal) return;
    const textChange = (current: string, original: string): string | null | undefined =>
      current === original ? undefined : current || null;
    const numberChange = (current: string, original: string): number | null | undefined =>
      current === original ? undefined : current ? Number(current) : null;
    const ageChange = (item: EquipmentEdit, original: EquipmentEdit): number | null | undefined => {
      if (item.ageKind === 'preserved') return undefined;
      if (original.ageKind === 'preserved') return item.age ? Number(item.age) : null;
      return numberChange(item.age, original.age);
    };
    correct({
      customer: {
        name: textChange(editState.customer.name, editOriginal.customer.name),
        city: textChange(editState.customer.city, editOriginal.customer.city),
        country: textChange(editState.customer.country, editOriginal.customer.country),
      },
      equipment: editState.equipment.map((item) => {
        const original =
          editOriginal.equipment.find((candidate) => candidate.id === item.id) ?? item;
        return {
          id: item.id,
          modality: textChange(item.modality, original.modality),
          quantity: numberChange(item.quantity, original.quantity),
          manufacturer: textChange(item.manufacturer, original.manufacturer),
          model: textChange(item.model, original.model),
          approximateAgeYears: ageChange(item, original),
          notes: textChange(item.notes, original.notes),
        };
      }),
    });
    setEditing(false);
  };

  return (
    <div className="capture-screen">
      <header className="capture-topbar">
        <div className="capture-topbar-row">
          <div className="capture-title">
            <h1>Capturar observación</h1>
            <p className="page-subtitle">Convierta notas de campo en evidencia trazable.</p>
          </div>
          <div className="capture-topbar-actions">
            <EngineStatus runtime={runtime} initialize={initializeRuntime} busy={busy} />
            {capture?.draft.state === 'SAVED' && (
              <button className="secondary-button" onClick={startNew}>
                Nueva captura
              </button>
            )}
          </div>
        </div>
        <ol className="pipeline-tracker" aria-label="Progreso de la captura">
          {CAPTURE_STAGES.map((stage, index) => (
            <li
              key={stage.key}
              className={index < stageIndex ? 'done' : index === stageIndex ? 'active' : 'upcoming'}
            >
              <span className="pipeline-index">{index + 1}</span>
              <span className="pipeline-label">{stage.label}</span>
            </li>
          ))}
        </ol>
      </header>

      <div className="capture-layout">
        <section className="transcript-panel">
          <div className="transcript-log" ref={transcriptLogRef} data-capture-id={capture?.id}>
            {!capture?.messages.length && optimisticMessages.length === 0 && (
              <div className="transcript-empty">
                <IconInbox className="transcript-empty-icon" />
                <strong>Comience con lo que observó.</strong>
                <p>
                  La instalación, las modalidades y las cantidades bastan para empezar. Los detalles
                  faltantes se preguntan después.
                </p>
                <button
                  className="example-prompt"
                  onClick={() =>
                    setInput(
                      'Estoy en el Hospital DemoCare Pacific, en Panama. Tienen dos resonadores y un tomógrafo.',
                    )
                  }
                >
                  Usar observación de demostración
                </button>
              </div>
            )}
            {capture?.messages.map((message) => (
              <div
                key={message.id}
                className={`transcript-entry role-${message.role.toLowerCase()}`}
              >
                <span className="transcript-role">{MESSAGE_ROLE_LABELS[message.role]}</span>
                <p className="transcript-text">{message.content}</p>
              </div>
            ))}
            {optimisticMessages.map((message) => (
              <div
                key={message.id}
                className="transcript-entry role-user"
                data-message-state="optimistic"
              >
                <span className="transcript-role">{MESSAGE_ROLE_LABELS.User}</span>
                <p className="transcript-text">{message.content}</p>
              </div>
            ))}
          </div>
          <div className="composer">
            <button
              className={`mic-button ${voiceState === 'recording' ? 'recording' : ''}`}
              onClick={toggleRecording}
              disabled={busy || capture?.draft.state === 'SAVED' || voiceState === 'transcribing'}
              aria-label={
                voiceState === 'recording'
                  ? 'Detener grabación'
                  : 'Dictar con el micrófono (transcripción local con QVAC)'
              }
              title={
                voiceState === 'recording'
                  ? 'Detener grabación'
                  : 'Dictar con el micrófono (transcripción local con QVAC)'
              }
            >
              <IconMic />
            </button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              aria-label="Describa lo que vio, o responda el seguimiento"
              placeholder="Describa lo que vio, o responda el seguimiento…"
              rows={2}
              disabled={busy || capture?.draft.state === 'SAVED'}
            />
            <button className="primary-button" onClick={send} disabled={busy || !input.trim()}>
              <IconSend className="btn-icon" />
              {busy ? 'Procesando…' : 'Enviar'}
            </button>
          </div>
          {voiceState !== 'idle' && (
            <div className={`voice-status voice-status-${voiceState}`}>
              {voiceState === 'recording' && (
                <span>Grabando… toque el micrófono para detener y transcribir localmente.</span>
              )}
              {voiceState === 'transcribing' && (
                <span>Transcribiendo localmente con QVAC (sin conexión a internet)…</span>
              )}
              {voiceState === 'permission-denied' && (
                <span>
                  Permiso de micrófono denegado. Actívelo en la configuración del sistema e
                  inténtelo de nuevo.
                </span>
              )}
              {voiceState === 'error' && <span>No se pudo transcribir el audio: {voiceError}</span>}
            </div>
          )}
          <div className="privacy-note">
            Local-first · las observaciones en bruto permanecen en este dispositivo · sin IA en la
            nube
          </div>
        </section>

        <aside className="ledger-panel">
          <div className="ledger-panel-heading">
            <div>
              <h2>Registro estructurado</h2>
              <p className="page-subtitle">Revisar antes de guardar.</p>
            </div>
            {capture &&
              capture.draft.equipment.length > 0 &&
              !editing &&
              capture.draft.state !== 'SAVED' && (
                <button className="text-button" onClick={beginEdit}>
                  Editar
                </button>
              )}
          </div>
          {!capture || capture.draft.equipment.length === 0 ? (
            <div className="structured-empty">Los campos extraídos aparecerán aquí.</div>
          ) : editing && editState ? (
            <div className="edit-form">
              <label>
                Centro
                <input
                  value={editState.customer.name}
                  onChange={(event) =>
                    setEditState({
                      ...editState,
                      customer: { ...editState.customer, name: event.target.value },
                    })
                  }
                />
              </label>
              <div className="two-columns">
                <label>
                  Ciudad
                  <input
                    value={editState.customer.city}
                    onChange={(event) =>
                      setEditState({
                        ...editState,
                        customer: { ...editState.customer, city: event.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  País
                  <input
                    value={editState.customer.country}
                    onChange={(event) =>
                      setEditState({
                        ...editState,
                        customer: { ...editState.customer, country: event.target.value },
                      })
                    }
                  />
                </label>
              </div>
              {editState.equipment.map((item, index) => (
                <div className="edit-equipment" key={item.id}>
                  <strong>Grupo de equipos {index + 1}</strong>
                  <div className="two-columns">
                    <label>
                      modalidad
                      <select
                        value={item.modality}
                        onChange={(event) =>
                          updateEquipmentField(item.id, 'modality', event.target.value)
                        }
                      >
                        <option value="">Desconocido (declarado)</option>
                        {MODALITIES.map((modality) => (
                          <option key={modality} value={modality}>
                            {modality}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(['quantity', 'manufacturer', 'model', 'notes'] as const).map((field) => (
                      <label key={field}>
                        {EQUIPMENT_EDIT_FIELD_LABELS[field]}
                        <input
                          value={item[field]}
                          onChange={(event) =>
                            updateEquipmentField(item.id, field, event.target.value)
                          }
                        />
                      </label>
                    ))}
                    <label>
                      antigüedad
                      {item.ageKind === 'preserved' ? (
                        <div className="preserved-age">
                          <span>{item.ageLabel}</span>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => clearPreservedAge(item.id)}
                          >
                            Borrar antigüedad
                          </button>
                        </div>
                      ) : (
                        <input
                          value={item.age}
                          onChange={(event) =>
                            updateEquipmentField(item.id, 'age', event.target.value)
                          }
                        />
                      )}
                    </label>
                  </div>
                </div>
              ))}
              <div className="action-row">
                <button className="secondary-button" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
                <button className="primary-button" onClick={applyEdit}>
                  Aplicar correcciones
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="facility-letterhead">
                <IconFacility className="facility-icon" />
                <div>
                  <strong>{fieldText(capture.draft.customer.name)}</strong>
                  <span>
                    {fieldText(capture.draft.customer.city)},{' '}
                    {fieldText(capture.draft.customer.country)}
                  </span>
                </div>
              </div>
              <table className="equipment-ledger">
                <thead>
                  <tr>
                    <th>Modalidad</th>
                    <th>Cant.</th>
                    <th>Fabricante</th>
                    <th>Modelo</th>
                    <th>Antigüedad</th>
                  </tr>
                </thead>
                <tbody>
                  {capture.draft.equipment.map((item) => (
                    <Fragment key={item.id}>
                      <tr>
                        <td>{fieldText(item.modality)}</td>
                        <td className="numeric">{fieldText(item.quantity)}</td>
                        <td>{fieldText(item.manufacturer)}</td>
                        <td>{fieldText(item.model)}</td>
                        <td>{fieldText(item.approximateAge, ageText)}</td>
                      </tr>
                      {item.contradictions.map((contradiction) => (
                        <tr className="contradiction-row" key={`${item.id}-${contradiction.field}`}>
                          <td colSpan={5}>
                            <p className="contradiction-note">
                              <IconFlag className="contradiction-icon" />
                              <span>
                                <b>
                                  Dos respuestas para {contradictionFieldLabel(contradiction.field)}
                                  .
                                </b>{' '}
                                Dijo «{contradiction.previousText}», luego «
                                {contradiction.currentText}». Ambas se conservan como evidencia.
                                Responda la pregunta para indicar cuál usar.
                              </span>
                            </p>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <div className="signoff-block">
                <div
                  className={`status-chip capture-state ${CAPTURE_STATE_CHIP_CLASS[capture.draft.state]}`}
                >
                  {CAPTURE_STATE_LABELS[capture.draft.state]}
                </div>
                {capture.pendingQuestion && (
                  <div className="next-question">
                    <span>
                      Pregunta {QUESTION_PRIORITY_LABELS[capture.pendingQuestion.priority]}
                    </span>
                    <p>{capture.pendingQuestion.text}</p>
                  </div>
                )}
                <div className="stacked-actions">
                  {capture.draft.state === 'NEEDS_FOLLOW_UP' &&
                    capture.draft.equipment.every((item) => item.contradictions.length === 0) && (
                      <button className="secondary-button" onClick={review} disabled={busy}>
                        Revisar información actual
                      </button>
                    )}
                  {capture.draft.state === 'READY_FOR_REVIEW' &&
                    !capture.reviewConfirmed &&
                    !reviewDismissed && (
                      <div className="confirmation-request">
                        <p>
                          El agente le leyó la observación de vuelta. Confírmela antes de que se
                          guarde.
                        </p>
                        <div className="action-row">
                          <button className="primary-button" onClick={confirm} disabled={busy}>
                            Sí, es correcto
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => setReviewDismissedAt(capture.messages.length)}
                            disabled={busy}
                          >
                            No, corregirlo
                          </button>
                        </div>
                      </div>
                    )}
                  {capture.draft.state === 'READY_FOR_REVIEW' &&
                    !capture.reviewConfirmed &&
                    reviewDismissed && (
                      <p className="review-dismissed-note">
                        Corrección pendiente — descríbala en el chat o use «Editar».
                      </p>
                    )}
                  {capture.draft.state === 'READY_FOR_REVIEW' && capture.reviewConfirmed && (
                    <button className="save-button" onClick={save} disabled={busy}>
                      Guardar observación
                    </button>
                  )}
                  {capture.draft.state === 'SAVED' && (
                    <div className="saved-banner">
                      <IconCheck className="btn-icon" />
                      Evidencia guardada localmente
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

const CustomersPage = ({
  customers,
  selected,
  select,
  busy,
  resolve,
}: {
  customers: readonly CustomerListItem[];
  selected: Customer360View | null;
  select: (id: string) => void;
  busy: boolean;
  resolve: (candidateId: string, resolution: ResolvedDuplicateResolution) => Promise<boolean>;
}): React.JSX.Element => {
  const [reviewing, setReviewing] = useState(false);
  const [reviewTab, setReviewTab] = useState<'pending' | 'resolved'>('pending');
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [selectedResolution, setSelectedResolution] = useState<ResolvedDuplicateResolution | null>(
    null,
  );
  const candidates = selected?.duplicateCandidates[reviewTab] ?? [];
  const activeCandidateIndex = Math.min(candidateIndex, Math.max(0, candidates.length - 1));
  const candidate = candidates[activeCandidateIndex] ?? null;

  const openReviews = (tab: 'pending' | 'resolved'): void => {
    setReviewTab(tab);
    setCandidateIndex(0);
    setSelectedResolution(null);
    setReviewing(true);
  };

  const recordResolution = (): void => {
    if (!candidate || selectedResolution === null) return;
    void resolve(candidate.id, selectedResolution).then((succeeded) => {
      if (!succeeded) return;
      setSelectedResolution(null);
      setCandidateIndex(0);
    });
  };

  return (
    <div className="customers-layout">
      <aside className="customer-directory">
        <h1>Cuentas respaldadas por evidencia</h1>
        <div className="customer-index">
          {customers.map((customer) => (
            <button
              key={customer.id}
              className={selected?.customer.id === customer.id ? 'selected' : ''}
              onClick={() => select(customer.id)}
            >
              <strong>{customer.name}</strong>
              <span>
                {customer.city ?? 'Ciudad desconocida'} · {customer.country ?? 'País desconocido'}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="customer-detail">
        {!selected ? (
          <div className="structured-empty">Seleccione un cliente.</div>
        ) : (
          (() => {
            const sessionEvidence = groupEvidenceBySession(selected.evidence);
            const equipmentLabels = equipmentLabelsById(selected.installedBase);
            const pendingDuplicates = selected.duplicateCandidates.pending.length;
            const resolvedDuplicates = selected.duplicateCandidates.resolved.length;
            return (
              <>
                <div className="facility-letterhead account-letterhead">
                  <IconFacility className="facility-icon" />
                  <div>
                    <h2>{selected.customer.name}</h2>
                    <p>
                      {selected.customer.city ?? 'Ciudad desconocida'},{' '}
                      {selected.customer.country ?? 'País desconocido'}
                    </p>
                  </div>
                </div>
                <div className="account-stats">
                  <div>
                    <strong>{sessionEvidence.length}</strong>
                    <span>
                      {plural(sessionEvidence.length, 'visita de respaldo', 'visitas de respaldo')}
                    </span>
                  </div>
                  <div>
                    <strong>{selected.installedBase.length}</strong>
                    <span>
                      {plural(
                        selected.installedBase.length,
                        'grupo de equipos',
                        'grupos de equipos',
                      )}
                    </span>
                  </div>
                  <div>
                    <strong>{pendingDuplicates}</strong>
                    <span>
                      {plural(pendingDuplicates, 'candidato pendiente', 'candidatos pendientes')}
                    </span>
                  </div>
                  <div>
                    <strong>{resolvedDuplicates}</strong>
                    <span>
                      {plural(resolvedDuplicates, 'candidato resuelto', 'candidatos resueltos')}
                    </span>
                  </div>
                </div>

                <div className="section-title">
                  <h3>Proyección actual del parque instalado</h3>
                </div>
                <div className="installed-base-ledger">
                  <div className="ledger-head-row">
                    <span>Modalidad</span>
                    <span>Fabricante / Modelo</span>
                    <span>Cant.</span>
                    <span>Antigüedad</span>
                    <span>Confianza</span>
                    <span>Estado</span>
                    <span aria-hidden="true" />
                  </div>
                  {selected.installedBase.map((item) => {
                    const rawModalityDiffers =
                      item.rawModality !== null &&
                      item.rawModality.trim().toLowerCase() !== item.modality.toLowerCase();
                    const fieldEntries = Object.entries(item.fieldProvenance);
                    return (
                      <details className="ledger-row" key={item.projectionKey}>
                        <summary className="ledger-row-summary">
                          <span className="ledger-cell">
                            {item.modality}
                            {rawModalityDiffers && (
                              <em className="raw-modality-note">
                                Capturado como «{item.rawModality}»
                              </em>
                            )}
                          </span>
                          <span className="ledger-cell">
                            {item.manufacturer ?? 'Fabricante desconocido'}
                            {item.model && <small> {item.model}</small>}
                          </span>
                          <span className="ledger-cell numeric">{item.quantity ?? '?'}</span>
                          <span className="ledger-cell">{ageText(item.approximateAge)}</span>
                          <span className="ledger-cell">
                            <span
                              className={`status-chip ${CONFIDENCE_CHIP_CLASS[item.confidence.level]}`}
                            >
                              {CONFIDENCE_LEVEL_LABELS[item.confidence.level]}
                            </span>
                          </span>
                          <span className="ledger-cell">
                            <span className={`status-chip ${STATUS_CHIP_CLASS[item.status]}`}>
                              {STATUS_LABELS[item.status]}
                            </span>
                          </span>
                          <span className="ledger-row-affordance">
                            <span className="ledger-row-affordance-label">Ver detalles</span>
                            <IconChevronRight className="ledger-row-chevron" />
                          </span>
                        </summary>
                        <div className="ledger-row-detail">
                          <dl>
                            <div>
                              <dt>Instalación</dt>
                              <dd>{installationText(item.installationEstimate)}</dd>
                            </div>
                            <div>
                              <dt>Última observación</dt>
                              <dd>Hace {plural(item.daysSinceLastObservation, 'día', 'días')}</dd>
                            </div>
                            <div>
                              <dt>Vigencia</dt>
                              <dd>{FRESHNESS_STATUS_LABELS[item.freshnessStatus]}</dd>
                            </div>
                            <div>
                              <dt>Respaldado por</dt>
                              <dd>
                                {plural(
                                  item.contributingObservationIds.length,
                                  'observación',
                                  'observaciones',
                                )}
                              </dd>
                            </div>
                          </dl>
                          <p className="status-explain">{STATUS_EXPLANATIONS[item.status]}</p>
                          {item.confidence.reasons.length > 0 && (
                            <ul className="confidence-reasons">
                              {item.confidence.reasons.map((reason) => (
                                <li key={reason.code}>
                                  {CONFIDENCE_REASON_LABELS[reason.code] ?? reason.code}
                                </li>
                              ))}
                            </ul>
                          )}
                          {fieldEntries.length > 0 && (
                            <div className="field-provenance">
                              <span className="field-label">Detalles del campo</span>
                              <ul>
                                {fieldEntries.map(([field, provenance]) => (
                                  <li key={field}>
                                    <strong>{FIELD_LABELS[field] ?? field}</strong>
                                    <span
                                      className={`provenance-badge knowledge-${provenance.knowledgeState}`}
                                    >
                                      {KNOWLEDGE_STATE_LABELS[provenance.knowledgeState]}
                                    </span>
                                    {provenance.knowledgeState === 'Known' && (
                                      <span className="provenance-badge certainty">
                                        {certaintyText(provenance.certainty)}
                                      </span>
                                    )}
                                    <span className="provenance-origin">
                                      {FIELD_ORIGIN_LABELS[provenance.origin]}
                                    </span>
                                    {wasCorrected(provenance.evidenceIds) && (
                                      <span className="provenance-badge corrected">Corregido</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>

                <div className="section-title">
                  <h3>Observaciones de respaldo</h3>
                  <span>Evidencia de solo adición, una fila por visita</span>
                </div>
                <div className="evidence-table">
                  {sessionEvidence.map((session) => (
                    <div className="evidence-row" key={session.sessionId}>
                      <div>
                        <strong>{new Date(session.observedAt).toLocaleDateString()}</strong>
                        <span>
                          {session.observerName} · {session.source}
                        </span>
                      </div>
                      {session.items.length > 0 ? (
                        <div className="evidence-text evidence-entries">
                          {session.items.map((item) => (
                            <EvidenceEntry item={item} key={item.id} />
                          ))}
                        </div>
                      ) : (
                        <p className="evidence-text">{session.rawInput ?? 'Evidencia sin texto'}</p>
                      )}
                      <div
                        className="evidence-supports"
                        title={session.equipmentObservationIds.join(', ')}
                      >
                        {[
                          ...new Set(
                            session.equipmentObservationIds.map(
                              (id) => equipmentLabels.get(id) ?? 'Equipo sin coincidencia',
                            ),
                          ),
                        ].map((label) => (
                          <span className="support-tag" key={label}>
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {pendingDuplicates + resolvedDuplicates > 0 && (
                  <div className="duplicate-notice">
                    <div>
                      <strong>Se detectaron posibles coincidencias</strong>
                      <span>
                        {plural(pendingDuplicates, 'candidato pendiente', 'candidatos pendientes')}{' '}
                        · {plural(resolvedDuplicates, 'candidato resuelto', 'candidatos resueltos')}
                        . Nunca se combinan automáticamente.
                      </span>
                    </div>
                    <div className="duplicate-notice-actions">
                      {pendingDuplicates > 0 && (
                        <button className="primary-button" onClick={() => openReviews('pending')}>
                          Revisar posibles coincidencias
                        </button>
                      )}
                      {resolvedDuplicates > 0 && (
                        <button
                          className="secondary-button"
                          onClick={() => openReviews('resolved')}
                        >
                          Ver resueltos
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {reviewing && (
                  <section className="duplicate-review-panel">
                    <div className="duplicate-review-heading">
                      <h3>Revisión humana: posibles coincidencias de equipos</h3>
                      <button className="secondary-button" onClick={() => setReviewing(false)}>
                        Volver a Customer 360
                      </button>
                    </div>
                    <div className="duplicate-review-tabs">
                      <button
                        className={reviewTab === 'pending' ? 'active' : ''}
                        onClick={() => openReviews('pending')}
                      >
                        Pendientes ({selected.duplicateCandidates.pending.length})
                      </button>
                      <button
                        className={reviewTab === 'resolved' ? 'active' : ''}
                        onClick={() => openReviews('resolved')}
                      >
                        Resueltos ({selected.duplicateCandidates.resolved.length})
                      </button>
                    </div>
                    {candidate ? (
                      <DuplicateReviewPanel
                        candidate={candidate}
                        candidatePosition={activeCandidateIndex}
                        candidateCount={candidates.length}
                        selectedResolution={selectedResolution}
                        busy={busy}
                        previous={() =>
                          setCandidateIndex(
                            activeCandidateIndex === 0
                              ? candidates.length - 1
                              : activeCandidateIndex - 1,
                          )
                        }
                        next={() =>
                          setCandidateIndex(
                            activeCandidateIndex === candidates.length - 1
                              ? 0
                              : activeCandidateIndex + 1,
                          )
                        }
                        chooseResolution={setSelectedResolution}
                        resolve={recordResolution}
                      />
                    ) : (
                      <div className="duplicate-review-empty">
                        {reviewTab === 'pending'
                          ? 'No hay candidatos duplicados pendientes de revisión.'
                          : 'Todavía no hay candidatos duplicados resueltos.'}
                      </div>
                    )}
                  </section>
                )}
              </>
            );
          })()
        )}
      </section>
    </div>
  );
};

const DashboardPage = ({ dashboard }: { dashboard: DashboardView | null }): React.JSX.Element => {
  const modalityMax = Math.max(1, ...Object.values(dashboard?.equipmentByModality ?? {}));
  const statusMax = Math.max(1, ...Object.values(dashboard?.equipmentByStatus ?? {}));
  const confidenceMax = Math.max(1, ...Object.values(dashboard?.equipmentByConfidence ?? {}));
  const ageBandMax = Math.max(1, ...(dashboard?.ageBands.map((band) => band.count) ?? []));
  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <h1>Resumen del parque instalado</h1>
        <span className="local-chip">Datos en el dispositivo</span>
      </div>
      {!dashboard ? (
        <div className="structured-empty">Cargando métricas locales…</div>
      ) : (
        <>
          <div className="stat-ledger">
            <div className="stat-block">
              <strong>{dashboard.totalCustomers}</strong>
              <span>Clientes totales</span>
              <small>instalaciones sintéticas</small>
            </div>
            <div className="stat-block">
              <strong>{dashboard.totalEquipmentObserved}</strong>
              <span>Equipos proyectados</span>
              <small>últimos grupos de evidencia</small>
            </div>
            <div className="stat-block">
              <strong>{dashboard.incompleteObservations}</strong>
              <span>Observaciones incompletas</span>
              <small>necesitan enriquecimiento</small>
            </div>
            <div className="stat-block">
              <strong>{dashboard.pendingDuplicateCandidates}</strong>
              <span>Candidatos pendientes</span>
              <small>revisión de duplicados</small>
            </div>
          </div>
          <div className="dashboard-grid">
            <article className="chart-card">
              <div className="section-title">
                <h3>Equipos por modalidad</h3>
                <span>Cantidad proyectada</span>
              </div>
              <div className="bars">
                {Object.entries(dashboard.equipmentByModality).map(([label, value]) => (
                  <div className="bar-row" key={label}>
                    <span>{label}</span>
                    <div className="bar-track">
                      <i style={{ width: `${(value / modalityMax) * 100}%` }} />
                    </div>
                    <b className="numeric">{value}</b>
                  </div>
                ))}
              </div>
            </article>
            <article className="chart-card">
              <div className="section-title">
                <h3>Estado de la información</h3>
                <span>Por estado declarado</span>
              </div>
              <div className="bars">
                {OBSERVATION_STATUSES.map((status) => (
                  <div className="bar-row" key={status}>
                    <span>{STATUS_LABELS[status]}</span>
                    <div className="bar-track">
                      <i
                        style={{
                          width: `${(dashboard.equipmentByStatus[status] / statusMax) * 100}%`,
                        }}
                      />
                    </div>
                    <b className="numeric">{dashboard.equipmentByStatus[status]}</b>
                  </div>
                ))}
              </div>
            </article>
            <article className="chart-card">
              <div className="section-title">
                <h3>Confianza</h3>
                <span>Nivel de confianza, no estado</span>
              </div>
              <div className="bars">
                {CONFIDENCE_LEVELS.map((level) => (
                  <div className="bar-row" key={level}>
                    <span>{CONFIDENCE_LEVEL_LABELS[level]}</span>
                    <div className="bar-track">
                      <i
                        style={{
                          width: `${(dashboard.equipmentByConfidence[level] / confidenceMax) * 100}%`,
                        }}
                      />
                    </div>
                    <b className="numeric">{dashboard.equipmentByConfidence[level]}</b>
                  </div>
                ))}
              </div>
            </article>
            <article className="chart-card">
              <div className="section-title">
                <h3>Bandas de antigüedad</h3>
                <span>Distribución descriptiva</span>
              </div>
              <div className="age-known-pair">
                <div>
                  <strong>{dashboard.ageKnown}</strong>
                  <span>Con antigüedad conocida</span>
                </div>
                <div>
                  <strong>{dashboard.ageUnknown}</strong>
                  <span>Sin dato</span>
                </div>
              </div>
              <div className="bars">
                {dashboard.ageBands.map((band) => (
                  <div className="bar-row" key={band.label}>
                    <span>{band.label}</span>
                    <div className="bar-track">
                      <i style={{ width: `${(band.count / ageBandMax) * 100}%` }} />
                    </div>
                    <b className="numeric">{band.count}</b>
                  </div>
                ))}
              </div>
            </article>
            <article className="chart-card">
              <div className="section-title">
                <h3>Equipos proyectados por país</h3>
                <span>Cantidad · visitas</span>
              </div>
              <div className="country-list">
                {dashboard.equipmentByCountry.map((row) => (
                  <div key={row.country}>
                    <span>{row.country}</span>
                    <span className="country-list-aux">{row.visitCount} visitas</span>
                    <b className="numeric">{row.equipmentCount}</b>
                  </div>
                ))}
              </div>
            </article>
            <article className="chart-card">
              <div className="section-title">
                <h3>Datos que requieren enriquecimiento</h3>
                <span>Campos faltantes</span>
              </div>
              <div className="country-list">
                {dashboard.fieldEnrichmentGaps.map((gap) => (
                  <div key={gap.field}>
                    <span>{FIELD_LABELS[gap.field]}</span>
                    <span className="country-list-aux">
                      {gap.declaredUnknown > 0
                        ? `${gap.declaredUnknown} desconocido declarado`
                        : ''}
                    </span>
                    <b className="numeric">{gap.missing}</b>
                  </div>
                ))}
              </div>
            </article>
          </div>
          <div className="policy-note">
            <strong>La vigencia (días desde la observación) permanece sin clasificar.</strong>
            <span>
              No se definieron umbrales de negocio de vigencia. Las bandas de antigüedad de arriba
              son una distribución descriptiva de los años reportados, no una política de
              obsolescencia.
            </span>
          </div>
        </>
      )}
    </section>
  );
};

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('capture');
  const [runtime, setRuntime] = useState<InferenceRuntimeInfo | null>(null);
  const [capture, setCapture] = useState<CaptureSessionView | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<
    readonly OptimisticConversationMessage[]
  >([]);
  const [customers, setCustomers] = useState<readonly CustomerListItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer360View | null>(null);
  const [dashboard, setDashboard] = useState<DashboardView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);
  const optimisticMessageSequenceRef = useRef(0);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Error inesperado.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshQueries = useCallback(async (): Promise<void> => {
    const [customerResult, dashboardResult] = await Promise.all([
      window.installedBaseApi.listCustomers(),
      window.installedBaseApi.getDashboard(),
    ]);
    setCustomers(unwrap(customerResult));
    setDashboard(unwrap(dashboardResult));
  }, []);

  const startNew = useCallback(async (): Promise<void> => {
    const result = await window.installedBaseApi.startCapture('Text');
    setCapture(unwrap(result));
    setOptimisticMessages([]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.installedBaseApi.getInferenceStatus(),
      window.installedBaseApi.listCustomers(),
      window.installedBaseApi.getDashboard(),
      window.installedBaseApi.startCapture('Text'),
    ])
      .then(async ([statusResult, customerResult, dashboardResult, captureResult]) => {
        const initialCustomers = unwrap(customerResult);
        const initialSelection = initialCustomers[0]
          ? unwrap(await window.installedBaseApi.getCustomer360(initialCustomers[0].id))
          : null;
        if (cancelled) return;
        setRuntime(unwrap(statusResult));
        setCustomers(initialCustomers);
        setDashboard(unwrap(dashboardResult));
        setCapture(unwrap(captureResult));
        setSelectedCustomer(initialSelection);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Error inesperado.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectCustomer = useCallback(
    (id: string): void => {
      void run(async () => {
        setSelectedCustomer(unwrap(await window.installedBaseApi.getCustomer360(id)));
      });
    },
    [run],
  );

  const submitCaptureMessage = useCallback(
    (text: string): boolean => {
      if (!capture || submitInFlightRef.current) return false;

      submitInFlightRef.current = true;
      const captureId = capture.id;
      const optimisticMessage = createOptimisticMessage(
        captureId,
        text,
        ++optimisticMessageSequenceRef.current,
        new Date().toISOString(),
      );
      setOptimisticMessages((current) => [...current, optimisticMessage]);

      void run(async () => {
        let authoritative: CaptureSessionView;
        try {
          authoritative = unwrap(
            await window.installedBaseApi.submitCaptureMessage(captureId, text),
          );
        } catch (cause) {
          throw captureSubmissionError(cause);
        }
        // The workflow response contains every message accepted for this capture, including a
        // message retained by the backend before a previous inference failure. Replace the
        // session wholesale and discard only this capture's temporary renderer entries; never
        // reconcile by message text, because equal text can be two legitimate turns.
        setCapture(authoritative);
        setOptimisticMessages((current) => reconcileOptimisticMessages(current, captureId));
        setRuntime(unwrap(await window.installedBaseApi.getInferenceStatus()));
      }).finally(() => {
        submitInFlightRef.current = false;
      });

      return true;
    },
    [capture, run],
  );

  const resolveDuplicateCandidate = useCallback(
    async (candidateId: string, resolution: ResolvedDuplicateResolution): Promise<boolean> => {
      const selectedCustomerId = selectedCustomer?.customer.id;
      if (!selectedCustomerId) return false;
      const result = await run(async () => {
        unwrap(await window.installedBaseApi.resolveDuplicateCandidate(candidateId, resolution));
        setSelectedCustomer(
          unwrap(await window.installedBaseApi.getCustomer360(selectedCustomerId)),
        );
        return true;
      });
      return result ?? false;
    },
    [run, selectedCustomer?.customer.id],
  );

  const navItems = useMemo(
    () => [
      { id: 'capture' as const, label: 'Capturar', Icon: IconLedger },
      { id: 'customers' as const, label: 'Customer 360', Icon: IconFacility },
      { id: 'dashboard' as const, label: 'Panel', Icon: IconChart },
    ],
    [],
  );

  return (
    <div className="app-shell">
      <aside className="main-nav">
        <div className="brand">
          <img src={luaLogo} alt="Lua" className="brand-mark" />
          <div className="brand-name">
            <strong>Lua</strong>
            <span>Inteligencia local</span>
          </div>
        </div>
        <nav>
          {navItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={page === id ? 'active' : ''}
              onClick={() => {
                setPage(id);
                if (id === 'customers' && !selectedCustomer && customers[0])
                  selectCustomer(customers[0].id);
              }}
            >
              <Icon className="nav-icon" />
              {label}
            </button>
          ))}
        </nav>
        <div className="nav-footer">
          <span>Modo de privacidad</span>
          <strong>Solo local</strong>
        </div>
      </aside>
      <main className="workspace">
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <IconClose />
            </button>
          </div>
        )}
        {page === 'capture' && (
          <CapturePage
            capture={capture}
            optimisticMessages={optimisticMessages.filter(
              (message) => message.captureId === capture?.id,
            )}
            runtime={runtime}
            busy={busy}
            initializeRuntime={() =>
              void run(async () =>
                setRuntime(unwrap(await window.installedBaseApi.initializeInference())),
              )
            }
            submit={submitCaptureMessage}
            review={() =>
              capture &&
              void run(async () =>
                setCapture(unwrap(await window.installedBaseApi.proceedToReview(capture.id))),
              )
            }
            confirm={() =>
              capture &&
              void run(async () =>
                setCapture(unwrap(await window.installedBaseApi.confirmReview(capture.id))),
              )
            }
            save={() =>
              capture &&
              void run(async () => {
                const saved = unwrap(await window.installedBaseApi.saveCapture(capture.id));
                setCapture(saved.capture);
                await refreshQueries();
                setPage('customers');
                selectCustomer(saved.customerId);
              })
            }
            correct={(correction) =>
              capture &&
              void run(async () =>
                setCapture(
                  unwrap(await window.installedBaseApi.correctCapture(capture.id, correction)),
                ),
              )
            }
            startNew={() => void run(startNew)}
          />
        )}
        {page === 'customers' && (
          <CustomersPage
            key={selectedCustomer?.customer.id ?? 'no-customer-selected'}
            customers={customers}
            selected={selectedCustomer}
            select={selectCustomer}
            busy={busy}
            resolve={resolveDuplicateCandidate}
          />
        )}
        {page === 'dashboard' && <DashboardPage dashboard={dashboard} />}
      </main>
    </div>
  );
}

export default App;
