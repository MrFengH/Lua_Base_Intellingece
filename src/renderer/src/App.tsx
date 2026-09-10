import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CaptureCorrection,
  CaptureSessionView,
  Customer360View,
  CustomerListItem,
  DashboardView,
  DuplicateCandidateReview,
  DuplicateReviewObservation,
  InferenceRuntimeInfo,
  InstalledBaseItem,
  ObservationEvidenceView,
} from '@/application/contracts';
import { MODALITIES } from '@/domain/model';
import { contradictionFieldLabel } from '@/domain/rules';
import type {
  ApproximateAge,
  ConfidenceAssessment,
  ConfidenceReasonCode,
  DraftField,
  DuplicateReasonCode,
  DuplicateResolution,
  EvidenceRelationship,
  FactCertainty,
  InstallationEstimate,
  KnowledgeState,
  ObservationStatus,
  ResolvedDuplicateResolution,
} from '@/domain';
import type { IpcResult } from '@/shared';

type Page = 'capture' | 'customers' | 'dashboard';

const unwrap = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

const fieldText = <T,>(field: DraftField<T>, format: (value: T) => string = String): string => {
  if (field.state === 'Known') return format(field.value);
  return field.state === 'DeclaredUnknown' ? 'Unknown (acknowledged)' : 'Missing';
};

const ageText = (age: ApproximateAge): string => {
  if (age.type === 'unknown') return 'Unknown';
  if (age.type === 'qualitative') return age.label;
  if (age.type === 'exact') return `${age.years} years`;
  if (age.minYears === age.maxYears) return `~${age.minYears} years`;
  return `${age.minYears}–${age.maxYears} years`;
};

/** Answers "how did the observer come to know this", per docs/DATA_SCHEMA.md. Fixed text per
 * status value, not derived from any one record, so it never re-infers status in the renderer. */
const STATUS_EXPLANATIONS: Record<ObservationStatus, string> = {
  Confirmed: 'Observer stated they saw the equipment directly.',
  Reported: 'Information was relayed from another person or source.',
  Estimated: 'Observer presented the account as an estimate.',
  Unknown: 'Observation source could not be established.',
};

/** Human labels for the coded confidence reasons already produced by
 * SimpleConfidenceScoringService. The reason code stays in the stored data; only the label is
 * presentational. */
const CONFIDENCE_REASON_LABELS: Record<ConfidenceReasonCode, string> = {
  NO_KNOWN_FACTS: 'No fields have a known value yet',
  EXPLICIT_FACTS: 'Some fields were explicitly stated',
  UNCERTAINTY_LANGUAGE: 'Some fields were uncertain',
  DERIVED_FACTS: 'Some fields were derived rather than reported',
  INCOMPLETE_FIELDS: 'Some fields are still incomplete',
};

const DUPLICATE_RELATIONSHIP_LABELS: Record<EvidenceRelationship, string> = {
  NoMatch: 'No match',
  PossibleDuplicate: 'Possible duplicate',
  PossibleCorroboration: 'Possible corroboration',
  PartialMatch: 'Partial match',
  PossibleConflict: 'Possible conflict',
};

const DUPLICATE_REASON_LABELS: Partial<Record<DuplicateReasonCode, string>> = {
  DIFFERENT_CUSTOMER: 'Different facility',
  SAME_CUSTOMER: 'Same facility',
  UNKNOWN_MODALITY: 'Modality is unknown',
  DIFFERENT_MODALITY: 'Different modality',
  SAME_MODALITY: 'Same modality',
  SAME_MANUFACTURER: 'Same manufacturer',
  DIFFERENT_MANUFACTURER: 'Different manufacturer',
  SAME_MODEL: 'Same model',
  DIFFERENT_MODEL: 'Different model',
  COMPATIBLE_AGE: 'Compatible approximate age',
  INCOMPATIBLE_AGE: 'Incompatible approximate age',
  INDEPENDENT_OBSERVER: 'Reported by a different observer',
  INDEPENDENT_VISIT: 'Reported during a different visit',
};

const DUPLICATE_RESOLUTION_LABELS: Record<DuplicateResolution, string> = {
  Unresolved: 'Pending review',
  NotDuplicate: 'Not duplicate',
  SameEquipment: 'Same equipment',
  CorroboratingEvidence: 'Corroborating evidence',
};

const DUPLICATE_RESOLUTION_OPTIONS: ReadonlyArray<{
  value: ResolvedDuplicateResolution;
  label: string;
  description: string;
}> = [
  {
    value: 'NotDuplicate',
    label: 'Not duplicate',
    description: 'These observations do not refer to the same equipment.',
  },
  {
    value: 'SameEquipment',
    label: 'Same equipment',
    description: 'They refer to the same equipment; both evidence records remain intact.',
  },
  {
    value: 'CorroboratingEvidence',
    label: 'Corroborating evidence',
    description: 'The new observation independently supports the existing record.',
  },
];

const FIELD_LABELS: Record<string, string> = {
  modality: 'Modality',
  quantity: 'Quantity',
  manufacturer: 'Manufacturer',
  model: 'Model',
  approximateAge: 'Approx. age',
  notes: 'Notes',
};

const KNOWLEDGE_STATE_LABELS: Record<KnowledgeState, string> = {
  Known: 'Known',
  DeclaredUnknown: 'Declared unknown',
  Missing: 'Not mentioned',
};

/** `null` means the extractor supplied no certainty at all, which must read differently from an
 * explicit `Unknown` classification — neither is promoted to `Explicit`. */
const certaintyText = (certainty: FactCertainty | null): string =>
  certainty === null ? 'Not supplied' : certainty;

/** A corrected field's evidence includes the `correction:` id the workflow service records when a
 * review edit is applied, so this reads existing provenance rather than inventing a history. */
const wasCorrected = (evidenceIds: readonly string[]): boolean =>
  evidenceIds.some((id) => id.startsWith('correction:'));

const installationText = (installation: InstallationEstimate): string => {
  if (installation.type === 'unknown') return 'Unknown';
  if (installation.type === 'year') return `~${installation.year} (derived)`;
  return `${installation.minYear}–${installation.maxYear} (derived)`;
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

interface SessionEvidenceGroup {
  sessionId: string;
  observedAt: string;
  observerName: string;
  source: string;
  rawInput: string | null;
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
      equipmentObservationIds: [item.equipmentObservationId],
    });
  });
  return [...bySession.values()];
};

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
    ? confidence.level
    : `${confidence.level} (${confidence.score.toFixed(2)})`;

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
    { label: 'Facility', source: facilityText(source), comparable: facilityText(comparable) },
    { label: 'Modality', source: source.modality, comparable: comparable.modality },
    {
      label: 'Quantity',
      source: source.quantity === null ? 'Unknown' : String(source.quantity),
      comparable: comparable.quantity === null ? 'Unknown' : String(comparable.quantity),
    },
    {
      label: 'Manufacturer',
      source: source.manufacturer ?? 'Unknown',
      comparable: comparable.manufacturer ?? 'Unknown',
    },
    {
      label: 'Model',
      source: source.model ?? 'Unknown',
      comparable: comparable.model ?? 'Unknown',
    },
    {
      label: 'Approx. age',
      source: ageText(source.approximateAge),
      comparable: ageText(comparable.approximateAge),
    },
    { label: 'Status', source: source.status, comparable: comparable.status },
    {
      label: 'Confidence',
      source: confidenceText(source.confidence),
      comparable: confidenceText(comparable.confidence),
    },
    {
      label: 'Observed / source',
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
          <span className={`relationship-badge relationship-${candidate.relationship}`}>
            {DUPLICATE_RELATIONSHIP_LABELS[candidate.relationship]}
          </span>
          <h4>Score: {candidate.score.toFixed(2)}</h4>
          <small>Detection algorithm: {candidate.algorithmVersion}</small>
        </div>
        <div className="candidate-navigation">
          <span>
            {candidatePosition + 1} of {candidateCount}
          </span>
          <button className="secondary-button" onClick={previous} disabled={candidateCount < 2}>
            Previous
          </button>
          <button className="secondary-button" onClick={next} disabled={candidateCount < 2}>
            Next
          </button>
        </div>
      </div>

      <section className="duplicate-reasons">
        <h4>Why it was flagged</h4>
        <ul>
          {candidate.reasons.map((reason) => (
            <li key={reason.code}>
              <span>
                {DUPLICATE_REASON_LABELS[reason.code] ??
                  (reason.detail.trim() || 'Recorded detector reason')}
              </span>
              <code>{reason.code}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="duplicate-comparison" aria-label="Duplicate candidate comparison">
        <div className="duplicate-comparison-row comparison-heading">
          <span>Field</span>
          <strong>New observation</strong>
          <strong>Existing comparable</strong>
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
          { label: 'New observation evidence', observation: candidate.sourceObservation },
          { label: 'Existing observation evidence', observation: candidate.comparableObservation },
        ].map(({ label, observation }) => (
          <article key={label}>
            <strong>{label}</strong>
            <p>{observation.rawEvidence ?? 'No text evidence was stored for this observation.'}</p>
            <small>
              {observation.observerName} · {new Date(observation.observedAt).toLocaleDateString()} ·{' '}
              {observation.source}
            </small>
          </article>
        ))}
      </section>

      {resolved ? (
        <div className="resolution-recorded">
          <strong>Human decision: {DUPLICATE_RESOLUTION_LABELS[candidate.resolution]}</strong>
          <span>Both original observations and their evidence remain unchanged.</span>
        </div>
      ) : (
        <fieldset className="duplicate-resolution">
          <legend>Record a human decision</legend>
          <p>
            Select one option, then record it explicitly. This never merges or edits either
            observation.
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
            {busy ? 'Recording decision…' : 'Record human decision'}
          </button>
        </fieldset>
      )}
    </article>
  );
};

const RuntimeBadge = ({
  runtime,
  initialize,
  busy,
}: {
  runtime: InferenceRuntimeInfo | null;
  initialize: () => void;
  busy: boolean;
}): React.JSX.Element => {
  if (!runtime) return <div className="runtime-card skeleton">Checking inference runtime…</div>;
  const ready = runtime.status === 'ready';
  return (
    <div className={`runtime-card ${runtime.engine === 'Development Mock' ? 'mock' : ''}`}>
      <div className="runtime-title">
        <span className={`status-dot ${ready ? 'ready' : runtime.status}`} />
        <strong>Inference Engine: {runtime.engine}</strong>
        <span className="runtime-state">{runtime.status.replaceAll('-', ' ')}</span>
      </div>
      <div className="runtime-grid">
        <span>Execution</span>
        <b>{runtime.execution}</b>
        <span>Model</span>
        <b>{runtime.model}</b>
        <span>Network for inference</span>
        <b>{runtime.networkRequiredForInference ? 'Yes' : 'No'}</b>
      </div>
      {runtime.detail && <p>{runtime.detail}</p>}
      {runtime.engine === 'QVAC' && !ready && (
        <button className="small-button" onClick={initialize} disabled={busy}>
          {busy ? 'Initializing…' : 'Initialize local model'}
        </button>
      )}
      {runtime.engine === 'Development Mock' && (
        <div className="mock-warning">Development Mock — not valid for the final QVAC demo</div>
      )}
    </div>
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
  runtime: InferenceRuntimeInfo | null;
  busy: boolean;
  initializeRuntime: () => void;
  submit: (text: string) => void;
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
  const send = (): void => {
    if (!input.trim()) return;
    submit(input.trim());
    setInput('');
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
    <div className="capture-layout">
      <section className="conversation-panel">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Capture observation</span>
            <h1>Turn field notes into traceable evidence.</h1>
          </div>
          {capture?.draft.state === 'SAVED' && (
            <button className="secondary-button" onClick={startNew}>
              New capture
            </button>
          )}
        </div>
        <RuntimeBadge runtime={runtime} initialize={initializeRuntime} busy={busy} />
        <div className="conversation">
          {!capture?.messages.length && (
            <div className="empty-conversation">
              <div className="empty-icon">✦</div>
              <strong>Start with what you observed.</strong>
              <p>
                Facility, modalities and quantities are enough to begin. Missing details come next.
              </p>
              <button
                className="example-prompt"
                onClick={() =>
                  setInput(
                    'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
                  )
                }
              >
                Use demo observation
              </button>
            </div>
          )}
          {capture?.messages.map((message) => (
            <div key={message.id} className={`message-row ${message.role.toLowerCase()}`}>
              <div className="message-label">{message.role}</div>
              <div className="message-bubble">{message.content}</div>
            </div>
          ))}
        </div>
        <div className="composer">
          <button className="mic-button" disabled title="QVAC speech-to-text is a future slice">
            ◉
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
            placeholder="Describe what you saw, or answer the follow-up…"
            rows={2}
            disabled={busy || capture?.draft.state === 'SAVED'}
          />
          <button className="primary-button" onClick={send} disabled={busy || !input.trim()}>
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
        <div className="privacy-note">
          Local-first · raw observations stay on this device · no cloud AI
        </div>
      </section>

      <aside className="structured-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Structured draft</span>
            <h2>Review before saving</h2>
          </div>
          {capture &&
            capture.draft.equipment.length > 0 &&
            !editing &&
            capture.draft.state !== 'SAVED' && (
              <button className="text-button" onClick={beginEdit}>
                Edit
              </button>
            )}
        </div>
        {!capture || capture.draft.equipment.length === 0 ? (
          <div className="structured-empty">Extracted fields will appear here.</div>
        ) : editing && editState ? (
          <div className="edit-form">
            <label>
              Facility
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
                City
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
                Country
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
                <strong>Equipment group {index + 1}</strong>
                <div className="two-columns">
                  <label>
                    modality
                    <select
                      value={item.modality}
                      onChange={(event) =>
                        updateEquipmentField(item.id, 'modality', event.target.value)
                      }
                    >
                      <option value="">Unknown (acknowledged)</option>
                      {MODALITIES.map((modality) => (
                        <option key={modality} value={modality}>
                          {modality}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(['quantity', 'manufacturer', 'model', 'notes'] as const).map((field) => (
                    <label key={field}>
                      {field}
                      <input
                        value={item[field]}
                        onChange={(event) =>
                          updateEquipmentField(item.id, field, event.target.value)
                        }
                      />
                    </label>
                  ))}
                  <label>
                    age
                    {item.ageKind === 'preserved' ? (
                      <div className="preserved-age">
                        <span>{item.ageLabel}</span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => clearPreservedAge(item.id)}
                        >
                          Clear age
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
                Cancel
              </button>
              <button className="primary-button" onClick={applyEdit}>
                Apply corrections
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="facility-summary">
              <span>Facility</span>
              <strong>{fieldText(capture.draft.customer.name)}</strong>
              <small>
                {fieldText(capture.draft.customer.city)},{' '}
                {fieldText(capture.draft.customer.country)}
              </small>
            </div>
            <div className="equipment-list">
              {capture.draft.equipment.map((item) => (
                <article className="equipment-card" key={item.id}>
                  <div className="equipment-title">
                    <span>{fieldText(item.modality)}</span>
                    <b>× {fieldText(item.quantity)}</b>
                  </div>
                  <dl>
                    <div>
                      <dt>Brand</dt>
                      <dd>{fieldText(item.manufacturer)}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>{fieldText(item.model)}</dd>
                    </div>
                    <div>
                      <dt>Age</dt>
                      <dd>{fieldText(item.approximateAge, ageText)}</dd>
                    </div>
                  </dl>
                  {item.contradictions.map((contradiction) => (
                    <p className="contradiction-note" key={contradiction.field}>
                      <b>Two answers for {contradictionFieldLabel(contradiction.field)}.</b> You
                      said “{contradiction.previousText}”, then “{contradiction.currentText}”. Both
                      are kept as evidence. Answer the question to say which one to use.
                    </p>
                  ))}
                </article>
              ))}
            </div>
            <div className={`capture-state state-${capture.draft.state.toLowerCase()}`}>
              <span>Capture state</span>
              <strong>{capture.draft.state.replaceAll('_', ' ')}</strong>
            </div>
            {capture.pendingQuestion && (
              <div className="next-question">
                <p>{capture.pendingQuestion.text}</p>
                <span>{capture.pendingQuestion.priority.toLowerCase()} question</span>
              </div>
            )}
            <div className="stacked-actions">
              {capture.draft.state === 'NEEDS_FOLLOW_UP' &&
                capture.draft.equipment.every((item) => item.contradictions.length === 0) && (
                  <button className="secondary-button" onClick={review} disabled={busy}>
                    Review current information
                  </button>
                )}
              {capture.draft.state === 'READY_FOR_REVIEW' && !capture.reviewConfirmed && (
                <div className="confirmation-request">
                  <p>The agent read the observation back to you. Confirm it before it is saved.</p>
                  <div className="action-row">
                    <button className="primary-button" onClick={confirm} disabled={busy}>
                      Yes, that is correct
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setEditing(true)}
                      disabled={busy}
                    >
                      No, correct it
                    </button>
                  </div>
                </div>
              )}
              {capture.draft.state === 'READY_FOR_REVIEW' && capture.reviewConfirmed && (
                <button className="save-button" onClick={save} disabled={busy}>
                  Save observation
                </button>
              )}
              {capture.draft.state === 'SAVED' && (
                <div className="saved-banner">✓ Evidence saved locally</div>
              )}
            </div>
          </>
        )}
      </aside>
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
      <aside className="customer-list-panel">
        <span className="eyebrow">Customer 360</span>
        <h1>Evidence-backed accounts</h1>
        <div className="customer-list">
          {customers.map((customer) => (
            <button
              key={customer.id}
              className={selected?.customer.id === customer.id ? 'selected' : ''}
              onClick={() => select(customer.id)}
            >
              <strong>{customer.name}</strong>
              <span>
                {customer.city ?? 'Unknown city'} · {customer.country ?? 'Unknown country'}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="customer-detail">
        {!selected ? (
          <div className="structured-empty">Select a customer.</div>
        ) : (
          (() => {
            const sessionEvidence = groupEvidenceBySession(selected.evidence);
            const equipmentLabels = equipmentLabelsById(selected.installedBase);
            return (
              <>
                <div className="customer-hero">
                  <div>
                    <span className="eyebrow">Facility</span>
                    <h2>{selected.customer.name}</h2>
                    <p>
                      {selected.customer.city ?? 'Unknown city'},{' '}
                      {selected.customer.country ?? 'Unknown country'}
                    </p>
                  </div>
                  <div className="evidence-pill">
                    {plural(sessionEvidence.length, 'supporting visit', 'supporting visits')}
                  </div>
                </div>
                <div className="section-title">
                  <h3>Current installed-base projection</h3>
                  <span>{selected.projectionStrategy}</span>
                </div>
                <div className="projection-grid">
                  {selected.installedBase.map((item) => {
                    const rawModalityDiffers =
                      item.rawModality !== null &&
                      item.rawModality.trim().toLowerCase() !== item.modality.toLowerCase();
                    const fieldEntries = Object.entries(item.fieldProvenance);
                    return (
                      <article className="projection-card" key={item.projectionKey}>
                        <div className="projection-top">
                          <span>{item.modality}</span>
                          <b>× {item.quantity ?? '?'}</b>
                        </div>
                        {rawModalityDiffers && (
                          <p className="raw-modality-note">
                            Normalized: {item.modality} · Captured as: “{item.rawModality}”
                          </p>
                        )}
                        <h4>
                          {item.manufacturer ?? 'Unknown brand'} <span>{item.model ?? ''}</span>
                        </h4>
                        <dl>
                          <div>
                            <dt>Approx. age</dt>
                            <dd>{ageText(item.approximateAge)}</dd>
                          </div>
                          <div>
                            <dt>Installation</dt>
                            <dd>{installationText(item.installationEstimate)}</dd>
                          </div>
                          <div>
                            <dt>Confidence</dt>
                            <dd>
                              {item.confidence.level}
                              {item.confidence.reasons.length > 0 && (
                                <ul className="confidence-reasons">
                                  {item.confidence.reasons.map((reason) => (
                                    <li key={reason.code}>
                                      {CONFIDENCE_REASON_LABELS[reason.code] ?? reason.code}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>
                              {item.status}
                              <span className="status-explain">
                                {STATUS_EXPLANATIONS[item.status]}
                              </span>
                            </dd>
                          </div>
                          <div>
                            <dt>Last observed</dt>
                            <dd>{plural(item.daysSinceLastObservation, 'day')} ago</dd>
                          </div>
                          <div>
                            <dt>Freshness</dt>
                            <dd>{item.freshnessStatus}</dd>
                          </div>
                        </dl>
                        {fieldEntries.length > 0 && (
                          <details className="field-provenance">
                            <summary>Field details</summary>
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
                                  <span className="provenance-origin">{provenance.origin}</span>
                                  {wasCorrected(provenance.evidenceIds) && (
                                    <span className="provenance-badge corrected">Corrected</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <small>
                          Backed by {plural(item.contributingObservationIds.length, 'observation')}
                        </small>
                      </article>
                    );
                  })}
                </div>
                <div className="section-title">
                  <h3>Supporting observations</h3>
                  <span>Append-only evidence, one row per visit</span>
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
                      <p className="evidence-text">{session.rawInput ?? 'Non-text evidence'}</p>
                      <div
                        className="evidence-supports"
                        title={session.equipmentObservationIds.join(', ')}
                      >
                        {[
                          ...new Set(
                            session.equipmentObservationIds.map(
                              (id) => equipmentLabels.get(id) ?? 'Unmatched equipment',
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
                {selected.duplicateCandidates.pending.length +
                  selected.duplicateCandidates.resolved.length >
                  0 && (
                  <div className="duplicate-box">
                    <div>
                      <strong>Possible matches detected</strong>
                      <span>
                        {plural(selected.duplicateCandidates.pending.length, 'pending candidate')} ·{' '}
                        {plural(selected.duplicateCandidates.resolved.length, 'resolved candidate')}
                        . Never merged automatically.
                      </span>
                    </div>
                    <div className="duplicate-box-actions">
                      {selected.duplicateCandidates.pending.length > 0 && (
                        <button className="primary-button" onClick={() => openReviews('pending')}>
                          Review possible matches
                        </button>
                      )}
                      {selected.duplicateCandidates.resolved.length > 0 && (
                        <button
                          className="secondary-button"
                          onClick={() => openReviews('resolved')}
                        >
                          View resolved
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {reviewing && (
                  <section className="duplicate-review-panel">
                    <div className="duplicate-review-heading">
                      <div>
                        <span className="eyebrow">Human review</span>
                        <h3>Possible equipment matches</h3>
                      </div>
                      <button className="secondary-button" onClick={() => setReviewing(false)}>
                        Back to Customer 360
                      </button>
                    </div>
                    <div className="duplicate-review-tabs">
                      <button
                        className={reviewTab === 'pending' ? 'active' : ''}
                        onClick={() => openReviews('pending')}
                      >
                        Pending ({selected.duplicateCandidates.pending.length})
                      </button>
                      <button
                        className={reviewTab === 'resolved' ? 'active' : ''}
                        onClick={() => openReviews('resolved')}
                      >
                        Resolved ({selected.duplicateCandidates.resolved.length})
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
                          ? 'No duplicate candidates are pending review.'
                          : 'No resolved duplicate candidates yet.'}
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
  const max = Math.max(1, ...Object.values(dashboard?.equipmentByModality ?? {}));
  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Local intelligence</span>
          <h1>Installed-base overview</h1>
        </div>
        <span className="local-chip">On-device data</span>
      </div>
      {!dashboard ? (
        <div className="structured-empty">Loading local metrics…</div>
      ) : (
        <>
          <div className="metric-grid">
            <article>
              <span>Total customers</span>
              <strong>{dashboard.totalCustomers}</strong>
              <small>synthetic facilities</small>
            </article>
            <article>
              <span>Equipment projected</span>
              <strong>{dashboard.totalEquipmentObserved}</strong>
              <small>latest evidence groups</small>
            </article>
            <article>
              <span>Incomplete observations</span>
              <strong>{dashboard.incompleteObservations}</strong>
              <small>need enrichment</small>
            </article>
            <article>
              <span>Aging equipment</span>
              <strong>—</strong>
              <small>{dashboard.agingPolicy}</small>
            </article>
          </div>
          <div className="dashboard-grid">
            <article className="chart-card">
              <div className="section-title">
                <h3>Equipment by modality</h3>
                <span>Projected quantity</span>
              </div>
              <div className="bars">
                {Object.entries(dashboard.equipmentByModality).map(([label, value]) => (
                  <div className="bar-row" key={label}>
                    <span>{label}</span>
                    <div className="bar-track">
                      <i style={{ width: `${(value / max) * 100}%` }} />
                    </div>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </article>
            <article className="chart-card">
              <div className="section-title">
                <h3>Observations by country</h3>
                <span>Saved sessions</span>
              </div>
              <div className="country-list">
                {Object.entries(dashboard.observationsByCountry).map(([country, count]) => (
                  <div key={country}>
                    <span>{country}</span>
                    <b>{count}</b>
                  </div>
                ))}
              </div>
            </article>
          </div>
          <div className="policy-note">
            <strong>Freshness is intentionally unclassified.</strong>
            <span>
              No business thresholds were supplied, so Fresh/Aging/Stale remains a configurable
              future rule.
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
  const [customers, setCustomers] = useState<readonly CustomerListItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer360View | null>(null);
  const [dashboard, setDashboard] = useState<DashboardView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unexpected error.');
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
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unexpected error.');
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
      { id: 'capture' as const, label: 'Capture', glyph: '✦' },
      { id: 'customers' as const, label: 'Customer 360', glyph: '◎' },
      { id: 'dashboard' as const, label: 'Dashboard', glyph: '▥' },
    ],
    [],
  );

  return (
    <div className="app-shell">
      <aside className="main-nav">
        <div className="brand">
          <div className="brand-mark">IB</div>
          <div>
            <strong>Installed Base</strong>
            <span>Intelligence</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => {
                setPage(item.id);
                if (item.id === 'customers' && !selectedCustomer && customers[0])
                  selectCustomer(customers[0].id);
              }}
            >
              <span>{item.glyph}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="nav-footer">
          <span>Privacy mode</span>
          <strong>Local only</strong>
        </div>
      </aside>
      <main className="workspace">
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}
        {page === 'capture' && (
          <CapturePage
            capture={capture}
            runtime={runtime}
            busy={busy}
            initializeRuntime={() =>
              void run(async () =>
                setRuntime(unwrap(await window.installedBaseApi.initializeInference())),
              )
            }
            submit={(text) =>
              capture &&
              void run(async () => {
                setCapture(
                  unwrap(await window.installedBaseApi.submitCaptureMessage(capture.id, text)),
                );
                setRuntime(unwrap(await window.installedBaseApi.getInferenceStatus()));
              })
            }
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
