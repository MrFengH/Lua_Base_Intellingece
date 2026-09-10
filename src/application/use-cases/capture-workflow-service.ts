import type {
  CaptureDraft,
  CaptureEquipmentDraft,
  ContradictionField,
  DraftField,
  EquipmentObservation,
  EvidenceItem,
  FactCertainty,
  FieldContradiction,
  FieldProvenance,
  FieldOrigin,
  FollowUpQuestion,
  Modality,
  ObservationBasis,
  ObservationSource,
  RestatementIntent,
  SavedObservationAggregate,
} from '@/domain';
import {
  classifyCrossGroupScope,
  classifyObservationBasis,
  classifyObservationBasisAnswer,
  classifyRestatementIntent,
  classifyReviewConfirmationReply,
  declaredUnknownField,
  deriveInstallationEstimate,
  deriveObservationStatus,
  describeApproximateAge,
  DuplicateDetectionService,
  FollowUpQuestionService,
  knownField,
  missingField,
  normalizeModality,
  normalizeName,
  OBSERVATION_BASIS_QUESTION_KEY,
  ReviewSummaryService,
  sameFieldValue,
  SimpleConfidenceScoringService,
} from '@/domain';
import type { CaptureCorrection, CaptureSessionView, ConversationMessage } from '../contracts';
import type {
  Clock,
  IdGenerator,
  InstalledBaseRepository,
  ObservationExtractionPort,
} from '../ports';
import type { ExtractedEquipment, ObservationExtraction } from '../contracts';

interface MutableCaptureSession {
  id: string;
  observerId: string;
  observerName: string;
  visitId: string;
  observedAt: string;
  source: ObservationSource;
  draft: CaptureDraft;
  messages: ConversationMessage[];
  /** Manual review corrections, kept as evidence so corrected fields stay traceable. */
  corrections: EvidenceItem[];
  pendingQuestion: FollowUpQuestion | null;
  /** The last summary the agent read back, so an unchanged draft is not summarised twice. */
  confirmationSummary: string | null;
  /** Set only by an explicit confirmation from the observer. Reaching review never sets it. */
  reviewConfirmed: boolean;
}

const unknownAge = { type: 'unknown' } as const;

const requiredComplete = (draft: CaptureDraft): boolean =>
  draft.customer.name.state !== 'Missing' &&
  draft.customer.city.state !== 'Missing' &&
  draft.customer.country.state !== 'Missing' &&
  draft.equipment.length > 0 &&
  draft.equipment.every(
    (equipment) => equipment.modality.state !== 'Missing' && equipment.quantity.state !== 'Missing',
  );

const unresolvedContradictions = (draft: CaptureDraft): readonly FieldContradiction[] =>
  draft.equipment.flatMap((item) => item.contradictions);

const nullableValue = <T>(field: DraftField<T>): T | null =>
  field.state === 'Known' ? field.value : null;

const knowledgeState = (field: DraftField<unknown>): 'Missing' | 'Known' | 'DeclaredUnknown' =>
  field.state;

const fieldOrigin = (field: DraftField<unknown>): FieldOrigin =>
  field.state === 'Known' ? field.origin : 'Unknown';

const fieldEvidence = (field: DraftField<unknown>): readonly string[] =>
  field.state === 'Missing' ? [] : field.evidenceIds;

const fieldCertainty = (field: DraftField<unknown>): FactCertainty | null =>
  field.state === 'Known' ? field.certainty : 'Unknown';

/**
 * Evidence is append-only, so a field that changes keeps every message that ever spoke about it.
 * A new evidence id is added to the earlier ones; it never replaces them.
 */
const accumulatedEvidence = (
  current: DraftField<unknown> | undefined,
  ...evidenceIds: readonly string[]
): readonly string[] => [...new Set([...(current ? fieldEvidence(current) : []), ...evidenceIds])];

const matchesContradiction = (contradiction: FieldContradiction, text: string): boolean =>
  sameFieldValue(contradiction.previousText, text) ||
  sameFieldValue(contradiction.currentText, text);

/** The contradiction a later answer resolves, if it names either of the two claims. */
const resolvedBy = (
  contradiction: FieldContradiction | undefined,
  text: string,
): FieldContradiction | null =>
  contradiction && matchesContradiction(contradiction, text) ? contradiction : null;

const isUnknownReply = (text: string, question: FollowUpQuestion): boolean => {
  const reply = text.trim();
  return (
    (/^no[.!?]*$/i.test(reply) && question.text.startsWith('¿Conoce')) ||
    /^(?:i\s+(?:do\s+not|don't)\s+know|unknown|not\s+sure|no\s+(?:lo\s+)?s[eé]|ni\s+idea(?:\s+la\s+verdad)?|no\s+estoy\s+segur[oa]|no\s+me\s+fij[eé]|no\s+sabr[ií]a\s+decir|desconocid[oa])(?=$|[\s.,;:!?])/i.test(
      reply,
    )
  );
};

export class CaptureWorkflowService {
  private readonly sessions = new Map<string, MutableCaptureSession>();
  private readonly followUp = new FollowUpQuestionService();
  private readonly reviewSummary = new ReviewSummaryService();
  private readonly confidence = new SimpleConfidenceScoringService();
  private readonly duplicates = new DuplicateDetectionService();

  constructor(
    private readonly extractor: ObservationExtractionPort,
    private readonly repository: InstalledBaseRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  start(input?: {
    source?: ObservationSource;
    observerId?: string;
    observerName?: string;
    observedAt?: string;
  }): CaptureSessionView {
    const id = this.ids.next();
    const session: MutableCaptureSession = {
      id,
      observerId: input?.observerId ?? 'demo-collaborator',
      observerName: input?.observerName ?? 'Demo Collaborator',
      visitId: this.ids.next(),
      observedAt: input?.observedAt ?? this.clock.now(),
      source: input?.source ?? 'Text',
      draft: {
        id,
        state: 'NEW',
        source: input?.source ?? 'Text',
        customer: {
          name: missingField(),
          city: missingField(),
          country: missingField(),
        },
        equipment: [],
        observationBasis: missingField(),
        askedQuestionKeys: [],
      },
      messages: [],
      corrections: [],
      pendingQuestion: null,
      confirmationSummary: null,
      reviewConfirmed: false,
    };
    this.sessions.set(id, session);
    return this.view(session);
  }

  get(id: string): CaptureSessionView {
    return this.view(this.requireSession(id));
  }

  async submitMessage(id: string, text: string): Promise<CaptureSessionView> {
    const session = this.requireSession(id);
    if (!text.trim()) throw new Error('El mensaje de captura no puede estar vacío.');
    if (session.draft.state === 'SAVED') throw new Error('La evidencia guardada es inmutable.');

    // Captured before extraction runs: `advance()` overwrites `session.pendingQuestion` with the
    // *next* question once this message is processed, so this is the only point that still holds
    // which question this message is answering.
    const answeredQuestion = session.pendingQuestion;
    const message: ConversationMessage = {
      id: this.ids.next(),
      role: 'User',
      content: text.trim(),
      createdAt: this.clock.now(),
    };
    session.messages.push(message);
    session.draft = { ...session.draft, state: 'EXTRACTING' };

    try {
      if (this.handleConfirmationReply(session, text)) {
        return this.view(session);
      }
      const answeredBasis = this.answerObservationBasis(session, text, message.id);
      if (answeredBasis) {
        session.draft = answeredBasis;
      } else if (session.pendingQuestion && isUnknownReply(text, session.pendingQuestion)) {
        session.draft = this.markPendingUnknown(session.draft, session.pendingQuestion, message.id);
      } else {
        const intent = classifyRestatementIntent(text);
        const extraction = await this.extractor.extract(text, {
          captureDraft: session.draft,
          pendingQuestion: session.pendingQuestion,
          conversation: session.messages.map((item) => ({
            role: item.role === 'User' ? 'user' : 'assistant',
            content: item.content,
          })),
          knownCustomers: this.repository.list(),
        });
        session.draft = this.mergeExtraction(session.draft, extraction, message.id, intent);
        if (answeredQuestion) {
          session.draft = this.propagateSharedAnswer(
            session.draft,
            answeredQuestion,
            message.id,
            intent,
            text,
          );
        }
        session.draft = this.applyStatedObservationBasis(session.draft, text, message.id);
      }
      this.advance(session);
      return this.view(session);
    } catch (error) {
      session.draft = { ...session.draft, state: 'ERROR' };
      throw error;
    }
  }

  correct(id: string, correction: CaptureCorrection): CaptureSessionView {
    const session = this.requireSession(id);
    if (session.draft.state === 'SAVED') throw new Error('La evidencia guardada es inmutable.');
    const evidenceId = `correction:${this.ids.next()}`;
    session.corrections.push({
      id: evidenceId,
      sessionId: session.id,
      source: session.source,
      capturedAt: this.clock.now(),
      rawText: 'Corrección manual aplicada por el observador durante la revisión.',
    });
    let customer = session.draft.customer;
    if (correction.customer) {
      customer = {
        name: this.correctText(customer.name, correction.customer.name, evidenceId),
        city: this.correctText(customer.city, correction.customer.city, evidenceId),
        country: this.correctText(customer.country, correction.customer.country, evidenceId),
      };
    }
    const equipment = session.draft.equipment.map((original) => {
      const change = correction.equipment?.find((candidate) => candidate.id === original.id);
      if (!change) return original;
      // A correction is the observer deciding, so every field they touched stops being an open
      // disagreement. The evidence behind the value they replaced stays on the field.
      const settled: ContradictionField[] = [];
      if (change.modality !== undefined) settled.push('Modality');
      if (change.quantity !== undefined) settled.push('Quantity');
      if (change.manufacturer !== undefined) settled.push('Manufacturer');
      if (change.model !== undefined) settled.push('Model');
      if (change.approximateAgeYears !== undefined) settled.push('ApproximateAge');
      const item = settled.reduce(
        (carried, field) => this.withoutContradiction(carried, field),
        original,
      );
      const previousEvidence = (field: ContradictionField): readonly string[] => {
        const entry = original.contradictions.find((candidate) => candidate.field === field);
        return entry ? [...entry.previousEvidenceIds, ...entry.currentEvidenceIds] : [];
      };
      return {
        ...item,
        modality:
          change.modality === undefined
            ? item.modality
            : change.modality === null
              ? declaredUnknownField<Modality>(
                  accumulatedEvidence(item.modality, ...previousEvidence('Modality'), evidenceId),
                )
              : knownField(
                  normalizeModality(change.modality),
                  'Reported',
                  accumulatedEvidence(item.modality, ...previousEvidence('Modality'), evidenceId),
                ),
        quantity: this.correctNumber(
          item.quantity,
          change.quantity,
          evidenceId,
          previousEvidence('Quantity'),
        ),
        manufacturer: this.correctText(
          item.manufacturer,
          change.manufacturer,
          evidenceId,
          previousEvidence('Manufacturer'),
        ),
        model: this.correctText(item.model, change.model, evidenceId, previousEvidence('Model')),
        approximateAge: this.correctAge(
          item.approximateAge,
          change.approximateAgeYears,
          evidenceId,
          previousEvidence('ApproximateAge'),
        ),
        notes: this.correctText(item.notes, change.notes, evidenceId),
      };
    });
    session.draft = { ...session.draft, customer, equipment };
    session.reviewConfirmed = false;
    session.confirmationSummary = null;
    this.advance(session);
    return this.view(session);
  }

  proceedToReview(id: string): CaptureSessionView {
    const session = this.requireSession(id);
    // Reviewing early must not bury a disagreement the observer has not settled. Confirmation
    // would otherwise turn "I am not sure which of the two" into a stored fact.
    if (unresolvedContradictions(session.draft).length > 0) {
      throw new Error('Responda la información contradictoria antes de revisar la observación.');
    }
    if (!requiredComplete(session.draft)) {
      throw new Error('Los campos obligatorios deben responderse o declararse desconocidos.');
    }
    session.pendingQuestion = null;
    session.draft = { ...session.draft, state: 'READY_FOR_REVIEW' };
    this.requestConfirmation(session);
    return this.view(session);
  }

  /**
   * The observer's explicit acceptance of the summary. Reaching `READY_FOR_REVIEW` is not an
   * acceptance, and neither is correcting a field: only this records that the draft was reviewed.
   */
  confirmReview(id: string): CaptureSessionView {
    const session = this.requireSession(id);
    if (session.draft.state !== 'READY_FOR_REVIEW') {
      throw new Error(
        'No hay nada que confirmar hasta que la observación esté lista para revisión.',
      );
    }
    this.recordConfirmation(session);
    return this.view(session);
  }

  save(id: string): { capture: CaptureSessionView; customerId: string } {
    const session = this.requireSession(id);
    if (session.draft.state !== 'READY_FOR_REVIEW') {
      throw new Error('Revise la observación estructurada antes de guardarla.');
    }
    if (!session.reviewConfirmed) {
      throw new Error('Confirme el resumen estructurado antes de guardarlo.');
    }
    const customerName = nullableValue(session.draft.customer.name);
    if (!customerName)
      throw new Error('El nombre del cliente es obligatorio para guardar una observación.');

    const now = this.clock.now();
    const normalizedName = normalizeName(customerName);
    const city = nullableValue(session.draft.customer.city);
    const country = nullableValue(session.draft.customer.country);
    const existing = this.repository.findByNormalizedIdentity(normalizedName, city, country);
    const customer =
      existing ??
      ({
        id: this.ids.next(),
        name: customerName,
        normalizedName,
        city,
        country,
        createdAt: now,
        updatedAt: now,
      } as const);
    const userMessages = session.messages.filter((message) => message.role === 'User');
    const evidenceIds = userMessages.map((message) => message.id);
    const equipment = session.draft.equipment.map((item) =>
      this.toEquipmentObservation(
        item,
        session.id,
        session.observedAt,
        evidenceIds,
        session.draft.observationBasis,
      ),
    );
    const aggregate: SavedObservationAggregate = {
      customer,
      session: {
        id: session.id,
        customerId: customer.id,
        observer: { id: session.observerId, displayName: session.observerName },
        visitId: session.visitId,
        observedAt: session.observedAt,
        createdAt: now,
        lastVerifiedAt: null,
        rawInput: userMessages.map((message) => message.content).join('\n'),
        reportedFacility: {
          name: customerName,
          normalizedName,
          city,
          country,
        },
        evidence: [
          ...userMessages.map((message) => ({
            id: message.id,
            sessionId: session.id,
            source: session.source,
            capturedAt: message.createdAt,
            rawText: message.content,
          })),
          ...session.corrections,
        ],
      },
      equipment,
    };

    const comparables = this.repository.findDuplicateComparables(customer.id);
    const duplicateCandidates = equipment.flatMap((source) =>
      comparables.flatMap((candidate) => {
        const score = this.duplicates.score(
          {
            id: source.id,
            customerId: customer.id,
            modality: source.modality,
            manufacturer: source.manufacturer,
            model: source.model,
            approximateAge: source.approximateAge,
            installationEstimate: source.installationEstimate,
            observerId: session.observerId,
            visitId: session.visitId,
          },
          candidate,
        );
        if (!score.isCandidate && score.relationship !== 'PossibleConflict') return [];
        return [
          {
            id: this.ids.next(),
            sourceObservationId: source.id,
            candidateObservationId: candidate.id,
            candidateInstalledBaseId: null,
            score: score.score,
            explanation: score.reasons,
            relationship: score.relationship,
            resolution: 'Unresolved' as const,
            algorithmVersion: score.algorithmVersion,
            createdAt: now,
          },
        ];
      }),
    );

    this.repository.saveAggregate(aggregate, duplicateCandidates);
    session.draft = { ...session.draft, state: 'SAVED' };
    session.pendingQuestion = null;
    return { capture: this.view(session), customerId: customer.id };
  }

  private toEquipmentObservation(
    item: CaptureEquipmentDraft,
    sessionId: string,
    observedAt: string,
    fallbackEvidenceIds: readonly string[],
    observationBasis: DraftField<ObservationBasis>,
  ): EquipmentObservation {
    const modality = nullableValue(item.modality) ?? 'Unknown';
    const approximateAge = nullableValue(item.approximateAge) ?? unknownAge;
    const provenanceEntries: Array<[string, DraftField<unknown>]> = [
      ['modality', item.modality],
      ['quantity', item.quantity],
      ['manufacturer', item.manufacturer],
      ['model', item.model],
      ['approximateAge', item.approximateAge],
      ['notes', item.notes],
    ];
    const fieldProvenance: Record<string, FieldProvenance> = Object.fromEntries(
      provenanceEntries.map(([field, value]) => [
        field,
        {
          knowledgeState: knowledgeState(value),
          origin: fieldOrigin(value),
          certainty: fieldCertainty(value),
          evidenceIds: fieldEvidence(value),
        },
      ]),
    );
    const confidence = this.confidence.assess(
      provenanceEntries.map(([field, value]) => ({
        field,
        knowledgeState: knowledgeState(value),
        origin: fieldOrigin(value),
        certainty: fieldCertainty(value),
        evidenceIds: fieldEvidence(value),
      })),
    );
    const collectedEvidenceIds = [
      ...new Set(provenanceEntries.flatMap(([, value]) => fieldEvidence(value))),
    ];
    return {
      id: this.ids.next(),
      sessionId,
      groupOrder: item.order,
      modality,
      rawModality: item.rawModality,
      quantity: nullableValue(item.quantity),
      manufacturer: nullableValue(item.manufacturer),
      model: nullableValue(item.model),
      approximateAge,
      installationEstimate: deriveInstallationEstimate(approximateAge, observedAt),
      confidence,
      status: deriveObservationStatus(observationBasis, approximateAge),
      notes: nullableValue(item.notes),
      evidenceIds: collectedEvidenceIds.length > 0 ? collectedEvidenceIds : fallbackEvidenceIds,
      fieldProvenance,
    };
  }

  private mergeExtraction(
    draft: CaptureDraft,
    extraction: ObservationExtraction,
    evidenceId: string,
    intent: RestatementIntent,
  ): CaptureDraft {
    const customerField = (
      current: DraftField<string>,
      value: string | null,
    ): DraftField<string> =>
      value === null
        ? current
        : knownField(value, 'Reported', accumulatedEvidence(current, evidenceId));
    const customer = {
      name: customerField(draft.customer.name, extraction.customer.name),
      city: customerField(draft.customer.city, extraction.customer.city),
      country: customerField(draft.customer.country, extraction.customer.country),
    };
    const existingByModality = new Map<Modality, CaptureEquipmentDraft[]>();
    draft.equipment.forEach((item) => {
      const modality = nullableValue(item.modality) ?? 'Unknown';
      existingByModality.set(modality, [...(existingByModality.get(modality) ?? []), item]);
    });
    const seen = new Map<Modality, number>();
    const merged = extraction.equipment.map((item, extractionIndex) => {
      const modality = normalizeModality(item.modality);
      const occurrence = seen.get(modality) ?? 0;
      seen.set(modality, occurrence + 1);
      const existing = existingByModality.get(modality)?.[occurrence];
      return this.mergeEquipment(existing, item, evidenceId, extractionIndex, intent);
    });
    const mergedIds = new Set(merged.map((item) => item.id));
    const equipment = [...draft.equipment.filter((item) => !mergedIds.has(item.id)), ...merged].map(
      (item, index) => ({ ...item, order: index }),
    );
    return { ...draft, customer, equipment };
  }

  /**
   * Fields an explicit cross-group scope answer can be shared across ("NovaMed para ambos").
   * Deliberately excludes `Modality` and `Quantity`: those are what make two equipment groups
   * distinct in the first place, so propagating one group's value onto another would erase the
   * difference between them rather than fill in a gap.
   */
  private static readonly SHARED_ANSWER_FIELDS = new Set<FollowUpQuestion['field']>([
    'Manufacturer',
    'Model',
    'ApproximateAge',
  ]);

  /**
   * Applies the value just merged into one equipment group to its sibling groups too, when (and
   * only when) the observer explicitly said the answer covers more than one group. This is a
   * deterministic, post-extraction step — the extractor itself is never asked to reason about
   * cross-group scope, and never sees this text differently because of it.
   *
   * "Both" claims exactly two groups, so it only ever applies when the draft holds exactly two;
   * with any other count, which two groups the observer meant is a genuine guess, so nothing is
   * propagated and the normal per-group follow-up flow continues unchanged. "All" claims the
   * whole set and carries no such ambiguity, whatever the count.
   *
   * Every sibling group is folded through the same three-way merge (`mergeField`) the primary
   * group already went through, so an existing, different, known value on a sibling group still
   * raises a contradiction instead of being silently overwritten — this reuses the review flow's
   * own disagreement handling rather than adding a second one next to it.
   */
  private propagateSharedAnswer(
    draft: CaptureDraft,
    question: FollowUpQuestion,
    evidenceId: string,
    intent: RestatementIntent,
    text: string,
  ): CaptureDraft {
    if (question.target.type !== 'Equipment') return draft;
    if (!CaptureWorkflowService.SHARED_ANSWER_FIELDS.has(question.field)) return draft;
    const scope = classifyCrossGroupScope(text);
    if (scope === null) return draft;
    if (scope === 'Both' && draft.equipment.length !== 2) return draft;

    const equipmentGroupId = question.target.equipmentGroupId;
    const primary = draft.equipment.find((item) => item.id === equipmentGroupId);
    if (!primary) return draft;

    const equipment = draft.equipment.map((item) => {
      if (item.id === primary.id) return item;
      return this.applySharedField(item, question.field, primary, evidenceId, intent);
    });
    return { ...draft, equipment };
  }

  /** Shares one already-resolved field from `primary` onto `item`, field-type by field-type. */
  private applySharedField(
    item: CaptureEquipmentDraft,
    field: FollowUpQuestion['field'],
    primary: CaptureEquipmentDraft,
    evidenceId: string,
    intent: RestatementIntent,
  ): CaptureEquipmentDraft {
    const contradictions = item.contradictions.filter((entry) => entry.field !== field);
    const open = item.contradictions.find((entry) => entry.field === field);
    if (field === 'Manufacturer') {
      if (primary.manufacturer.state !== 'Known') return item;
      const manufacturer = this.mergeField(
        'Manufacturer',
        item.manufacturer,
        primary.manufacturer.value,
        evidenceId,
        primary.manufacturer.certainty,
        intent,
        open,
        (value) => value,
        contradictions,
      );
      return { ...item, manufacturer, contradictions };
    }
    if (field === 'Model') {
      if (primary.model.state !== 'Known') return item;
      const model = this.mergeField(
        'Model',
        item.model,
        primary.model.value,
        evidenceId,
        primary.model.certainty,
        intent,
        open,
        (value) => value,
        contradictions,
      );
      return { ...item, model, contradictions };
    }
    if (primary.approximateAge.state !== 'Known') return item;
    const approximateAge = this.mergeField(
      'ApproximateAge',
      item.approximateAge,
      primary.approximateAge.value,
      evidenceId,
      primary.approximateAge.certainty,
      intent,
      open,
      describeApproximateAge,
      contradictions,
    );
    return { ...item, approximateAge, contradictions };
  }

  /**
   * Merges one extracted field into the draft, and is the only place a known value can be
   * replaced by a different one. Three outcomes, and the choice between them never depends on
   * the values themselves:
   *
   * - **Enrichment.** The field was missing, declared unknown, or already holds the same value.
   *   The new value is simply taken.
   * - **Self-correction.** The observer's wording says the earlier value was wrong, so the new
   *   value is taken with the certainty it was stated with.
   * - **Contradiction.** Two real claims disagree and nothing says which is right. The later
   *   value stays active so review has something to show, but it is marked `Uncertain` and the
   *   disagreement is recorded so a follow-up can name both.
   *
   * In every outcome the field keeps the evidence ids of the earlier claim.
   */
  private mergeField<T>(
    field: ContradictionField,
    current: DraftField<T> | undefined,
    value: T,
    evidenceId: string,
    certainty: FactCertainty | null,
    intent: RestatementIntent,
    open: FieldContradiction | undefined,
    describe: (value: T) => string,
    contradictions: FieldContradiction[],
  ): DraftField<T> {
    const text = describe(value);
    const resolved = resolvedBy(open, text);
    if (resolved) {
      // The observer named one of the two claims. That is an answer, so the field becomes
      // explicit again and keeps the evidence behind both sides of the disagreement.
      return knownField(
        value,
        'Reported',
        accumulatedEvidence(
          current,
          ...resolved.previousEvidenceIds,
          ...resolved.currentEvidenceIds,
          evidenceId,
        ),
        'Explicit',
      );
    }
    const evidenceIds = accumulatedEvidence(current, evidenceId);
    const disagrees = current?.state === 'Known' && !sameFieldValue(current.value, value);
    if (open) {
      // A third value while the first pair is still open. Keep asking, now about the two most
      // recent claims; the earliest claim stays reachable through the accumulated evidence ids.
      contradictions.push({
        field,
        previousText: open.currentText,
        previousEvidenceIds: open.currentEvidenceIds,
        currentText: text,
        currentEvidenceIds: [evidenceId],
      });
      return knownField(value, 'Reported', evidenceIds, 'Uncertain');
    }
    if (disagrees && intent !== 'SelfCorrection' && current.state === 'Known') {
      contradictions.push({
        field,
        previousText: describe(current.value),
        previousEvidenceIds: current.evidenceIds,
        currentText: text,
        currentEvidenceIds: [evidenceId],
      });
      return knownField(value, 'Reported', evidenceIds, 'Uncertain');
    }
    return knownField(value, 'Reported', evidenceIds, certainty);
  }

  private mergeEquipment(
    existing: CaptureEquipmentDraft | undefined,
    value: ExtractedEquipment,
    evidenceId: string,
    order: number,
    intent: RestatementIntent,
  ): CaptureEquipmentDraft {
    const openBefore = existing?.contradictions ?? [];
    const contradictions: FieldContradiction[] = [];
    const open = (field: ContradictionField): FieldContradiction | undefined =>
      openBefore.find((item) => item.field === field);
    const merge = <T>(
      field: ContradictionField,
      current: DraftField<T> | undefined,
      next: T,
      describe: (value: T) => string,
    ): DraftField<T> =>
      this.mergeField(
        field,
        current,
        next,
        evidenceId,
        value.certainty,
        intent,
        open(field),
        describe,
        contradictions,
      );
    const untouched = <T>(field: ContradictionField, current: DraftField<T> | undefined) => {
      const stillOpen = open(field);
      if (stillOpen) contradictions.push(stillOpen);
      return current ?? missingField<T>();
    };
    return {
      id: existing?.id ?? this.ids.next(),
      order: existing?.order ?? order,
      modality: merge(
        'Modality',
        existing?.modality,
        normalizeModality(value.modality),
        (item) => item,
      ),
      rawModality: value.rawModality ?? existing?.rawModality ?? null,
      quantity:
        value.quantity === null
          ? untouched('Quantity', existing?.quantity)
          : merge('Quantity', existing?.quantity, value.quantity, String),
      manufacturer:
        value.manufacturer === null
          ? untouched('Manufacturer', existing?.manufacturer)
          : merge('Manufacturer', existing?.manufacturer, value.manufacturer, (item) => item),
      model:
        value.model === null
          ? untouched('Model', existing?.model)
          : merge('Model', existing?.model, value.model, (item) => item),
      approximateAge:
        value.approximateAge.type === 'unknown'
          ? untouched('ApproximateAge', existing?.approximateAge)
          : merge(
              'ApproximateAge',
              existing?.approximateAge,
              value.approximateAge,
              describeApproximateAge,
            ),
      notes:
        value.notes === null
          ? (existing?.notes ?? missingField<string>())
          : knownField(
              value.notes,
              'Reported',
              accumulatedEvidence(existing?.notes, evidenceId),
              value.certainty,
            ),
      contradictions,
    };
  }

  private markPendingUnknown(
    draft: CaptureDraft,
    question: FollowUpQuestion,
    evidenceId: string,
  ): CaptureDraft {
    if (question.target.type === 'Customer') {
      const customer = { ...draft.customer };
      if (question.field === 'CustomerName')
        customer.name = declaredUnknownField<string>(
          accumulatedEvidence(customer.name, evidenceId),
        );
      if (question.field === 'Location') {
        if (customer.city.state === 'Missing')
          customer.city = declaredUnknownField<string>([evidenceId]);
        if (customer.country.state === 'Missing')
          customer.country = declaredUnknownField<string>([evidenceId]);
      }
      return { ...draft, customer };
    }
    if (question.key === OBSERVATION_BASIS_QUESTION_KEY) {
      return { ...draft, observationBasis: declaredUnknownField<ObservationBasis>([evidenceId]) };
    }
    if (question.target.type !== 'Equipment') return draft;
    const equipmentGroupId = question.target.equipmentGroupId;
    const equipment = draft.equipment.map((original) => {
      if (original.id !== equipmentGroupId) return original;
      // Declining to settle a contradiction is an answer too: the field becomes declared
      // unknown, the disagreement stops being open, and both claims stay in the evidence.
      const item = this.withoutContradiction(original, question.field);
      const unknown = <T>(current: DraftField<T>): DraftField<T> =>
        declaredUnknownField<T>(
          accumulatedEvidence(
            current,
            ...this.contradictionEvidence(original, question),
            evidenceId,
          ),
        );
      if (question.field === 'Modality') return { ...item, modality: unknown(item.modality) };
      if (question.field === 'Quantity') return { ...item, quantity: unknown(item.quantity) };
      if (question.field === 'Manufacturer')
        return { ...item, manufacturer: unknown(item.manufacturer) };
      if (question.field === 'ApproximateAge')
        return { ...item, approximateAge: unknown(item.approximateAge) };
      if (question.field === 'Model') return { ...item, model: unknown(item.model) };
      if (question.field === 'Notes') return { ...item, notes: unknown(item.notes) };
      return item;
    });
    return { ...draft, equipment };
  }

  /**
   * Drops the open disagreement about one field because it has just been settled. Only the
   * record of the open question goes; the evidence ids of both claims are folded into the field.
   */
  private withoutContradiction(
    item: CaptureEquipmentDraft,
    field: FollowUpQuestion['field'] | ContradictionField,
  ): CaptureEquipmentDraft {
    if (item.contradictions.length === 0) return item;
    return {
      ...item,
      contradictions: item.contradictions.filter((entry) => entry.field !== field),
    };
  }

  private contradictionEvidence(
    item: CaptureEquipmentDraft,
    question: FollowUpQuestion,
  ): readonly string[] {
    const entry = item.contradictions.find((candidate) => candidate.field === question.field);
    return entry ? [...entry.previousEvidenceIds, ...entry.currentEvidenceIds] : [];
  }

  private advance(session: MutableCaptureSession): void {
    const question = this.followUp.next(session.draft);
    session.pendingQuestion = question;
    if (question) {
      // A draft that needs another answer is no longer the draft the observer accepted, so any
      // confirmation is withdrawn. A contradiction raised after "yes, that is correct" is the
      // case this exists for.
      session.reviewConfirmed = false;
      session.confirmationSummary = null;
      if (!session.draft.askedQuestionKeys.includes(question.key)) {
        session.messages.push({
          id: this.ids.next(),
          role: 'Assistant',
          content: question.text,
          createdAt: this.clock.now(),
        });
      }
      session.draft = {
        ...session.draft,
        state: 'NEEDS_FOLLOW_UP',
        askedQuestionKeys: [...new Set([...session.draft.askedQuestionKeys, question.key])],
      };
      return;
    }
    session.draft = { ...session.draft, state: 'READY_FOR_REVIEW' };
    this.requestConfirmation(session);
  }

  /**
   * Reads the draft back to the observer and asks for confirmation. The summary is built from the
   * draft by `ReviewSummaryService`, never by a second inference call. A draft that changed since
   * the last summary invalidates any confirmation already given, because the observer accepted
   * different content.
   */
  private requestConfirmation(session: MutableCaptureSession): void {
    const summary = this.reviewSummary.summarize(session.draft);
    if (summary === session.confirmationSummary) return;
    session.confirmationSummary = summary;
    session.reviewConfirmed = false;
    session.messages.push({
      id: this.ids.next(),
      role: 'Assistant',
      content: summary,
      createdAt: this.clock.now(),
    });
  }

  private recordConfirmation(session: MutableCaptureSession): void {
    if (session.reviewConfirmed) return;
    session.reviewConfirmed = true;
    session.corrections.push({
      id: `confirmation:${this.ids.next()}`,
      sessionId: session.id,
      source: session.source,
      capturedAt: this.clock.now(),
      rawText: 'El observador confirmó el resumen estructurado antes de guardarlo.',
    });
    session.messages.push({
      id: this.ids.next(),
      role: 'Assistant',
      content: 'Gracias. La observación está confirmada y lista para guardar.',
      createdAt: this.clock.now(),
    });
  }

  /**
   * Handles a reply to the closing confirmation question. Returns `true` when the reply was a
   * confirmation or a rejection, so it is not also fed to the extractor. Anything else falls
   * through and is treated as a spoken correction.
   */
  private handleConfirmationReply(session: MutableCaptureSession, text: string): boolean {
    if (session.confirmationSummary === null || session.pendingQuestion !== null) return false;
    const reply = classifyReviewConfirmationReply(text);
    if (reply === 'Unrelated') return false;
    session.draft = { ...session.draft, state: 'READY_FOR_REVIEW' };
    if (reply === 'Confirm') {
      this.recordConfirmation(session);
      return true;
    }
    session.reviewConfirmed = false;
    session.messages.push({
      id: this.ids.next(),
      role: 'Assistant',
      content: 'Entendido, no se guardó nada. Dígame qué debe cambiar, o corríjalo directamente.',
      createdAt: this.clock.now(),
    });
    return true;
  }

  /** The reply to the provenance question, when that is what is pending. */
  private answerObservationBasis(
    session: MutableCaptureSession,
    text: string,
    evidenceId: string,
  ): CaptureDraft | null {
    if (session.pendingQuestion?.key !== OBSERVATION_BASIS_QUESTION_KEY) return null;
    const basis = classifyObservationBasisAnswer(text);
    if (basis === null) return null;
    return {
      ...session.draft,
      observationBasis: knownField(basis, 'Observed', [evidenceId]),
    };
  }

  /**
   * Picks up an unambiguous statement of provenance made in ordinary capture text, so that
   * "el técnico me dijo que tienen dos MR" does not need a follow-up. Wording that does not make
   * the source plain leaves the basis missing, and the follow-up question asks for it.
   */
  private applyStatedObservationBasis(
    draft: CaptureDraft,
    text: string,
    evidenceId: string,
  ): CaptureDraft {
    if (draft.observationBasis.state !== 'Missing') return draft;
    const basis = classifyObservationBasis(text);
    if (basis === null) return draft;
    return { ...draft, observationBasis: knownField(basis, 'Observed', [evidenceId]) };
  }

  private correctText(
    current: DraftField<string>,
    value: string | null | undefined,
    evidenceId: string,
    extraEvidenceIds: readonly string[] = [],
  ): DraftField<string> {
    if (value === undefined) return current;
    const evidenceIds = accumulatedEvidence(current, ...extraEvidenceIds, evidenceId);
    return value === null || value.trim() === ''
      ? declaredUnknownField(evidenceIds)
      : knownField(value.trim(), 'Reported', evidenceIds);
  }

  private correctNumber(
    current: DraftField<number>,
    value: number | null | undefined,
    evidenceId: string,
    extraEvidenceIds: readonly string[] = [],
  ): DraftField<number> {
    if (value === undefined) return current;
    const evidenceIds = accumulatedEvidence(current, ...extraEvidenceIds, evidenceId);
    return value === null
      ? declaredUnknownField(evidenceIds)
      : knownField(value, 'Reported', evidenceIds);
  }

  /**
   * `undefined` means the observer did not touch this field, so any existing age — including a
   * qualitative label, a range, or a min/max estimate — must survive untouched. `null` is an
   * explicit clear action. A number is an explicit exact age, never a fabricated min-equals-max
   * estimate.
   */
  private correctAge(
    current: DraftField<ExtractedEquipment['approximateAge']>,
    value: number | null | undefined,
    evidenceId: string,
    extraEvidenceIds: readonly string[] = [],
  ): DraftField<ExtractedEquipment['approximateAge']> {
    if (value === undefined) return current;
    const evidenceIds = accumulatedEvidence(current, ...extraEvidenceIds, evidenceId);
    return value === null
      ? declaredUnknownField<ExtractedEquipment['approximateAge']>(evidenceIds)
      : knownField({ type: 'exact' as const, years: value }, 'Reported', evidenceIds);
  }

  private requireSession(id: string): MutableCaptureSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Capture ${id} was not found.`);
    return session;
  }

  private view(session: MutableCaptureSession): CaptureSessionView {
    return {
      ...session,
      draft: structuredClone(session.draft),
      messages: structuredClone(session.messages),
      pendingQuestion: structuredClone(session.pendingQuestion),
      reviewConfirmed: session.reviewConfirmed,
    };
  }
}
