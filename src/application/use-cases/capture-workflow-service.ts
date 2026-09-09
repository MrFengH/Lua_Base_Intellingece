import type {
  CaptureDraft,
  CaptureEquipmentDraft,
  DraftField,
  EquipmentObservation,
  FactCertainty,
  FieldProvenance,
  FieldOrigin,
  FollowUpQuestion,
  Modality,
  ObservationSource,
  SavedObservationAggregate,
} from '@/domain';
import {
  declaredUnknownField,
  deriveInstallationEstimate,
  DuplicateDetectionService,
  FollowUpQuestionService,
  knownField,
  missingField,
  normalizeModality,
  normalizeName,
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
  pendingQuestion: FollowUpQuestion | null;
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

const nullableValue = <T>(field: DraftField<T>): T | null =>
  field.state === 'Known' ? field.value : null;

const knowledgeState = (field: DraftField<unknown>): 'Missing' | 'Known' | 'DeclaredUnknown' =>
  field.state;

const fieldOrigin = (field: DraftField<unknown>): FieldOrigin =>
  field.state === 'Known' ? field.origin : 'Unknown';

const fieldEvidence = (field: DraftField<unknown>): readonly string[] =>
  field.state === 'Missing' ? [] : field.evidenceIds;

const textOrUnknown = (value: string | null, evidenceId: string): DraftField<string> =>
  value === null ? missingField<string>() : knownField(value, 'Reported', [evidenceId]);

const ageOrMissing = (
  value: ExtractedEquipment['approximateAge'],
  evidenceId: string,
): DraftField<ExtractedEquipment['approximateAge']> =>
  value.type === 'unknown'
    ? missingField<ExtractedEquipment['approximateAge']>()
    : knownField(value, 'Reported', [evidenceId]);

const isUnknownReply = (text: string, question: FollowUpQuestion): boolean => {
  const reply = text.trim();
  return (
    (/^no[.!?]*$/i.test(reply) && question.text.startsWith('Do you know')) ||
    /^(?:i\s+(?:do\s+not|don't)\s+know|unknown|not\s+sure|no\s+(?:lo\s+)?s[eé]|ni\s+idea(?:\s+la\s+verdad)?|no\s+estoy\s+segur[oa]|no\s+me\s+fij[eé]|no\s+sabr[ií]a\s+decir|desconocid[oa])(?=$|[\s.,;:!?])/i.test(
      reply,
    )
  );
};

export class CaptureWorkflowService {
  private readonly sessions = new Map<string, MutableCaptureSession>();
  private readonly followUp = new FollowUpQuestionService();
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
        askedQuestionKeys: [],
      },
      messages: [],
      pendingQuestion: null,
    };
    this.sessions.set(id, session);
    return this.view(session);
  }

  get(id: string): CaptureSessionView {
    return this.view(this.requireSession(id));
  }

  async submitMessage(id: string, text: string): Promise<CaptureSessionView> {
    const session = this.requireSession(id);
    if (!text.trim()) throw new Error('A capture message cannot be empty.');
    if (session.draft.state === 'SAVED') throw new Error('Saved evidence is immutable.');

    const message: ConversationMessage = {
      id: this.ids.next(),
      role: 'User',
      content: text.trim(),
      createdAt: this.clock.now(),
    };
    session.messages.push(message);
    session.draft = { ...session.draft, state: 'EXTRACTING' };

    try {
      if (session.pendingQuestion && isUnknownReply(text, session.pendingQuestion)) {
        session.draft = this.markPendingUnknown(session.draft, session.pendingQuestion, message.id);
      } else {
        const extraction = await this.extractor.extract(text, {
          captureDraft: session.draft,
          pendingQuestion: session.pendingQuestion,
          conversation: session.messages.map((item) => ({
            role: item.role === 'User' ? 'user' : 'assistant',
            content: item.content,
          })),
          knownCustomers: this.repository.list(),
        });
        session.draft = this.mergeExtraction(session.draft, extraction, message.id);
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
    if (session.draft.state === 'SAVED') throw new Error('Saved evidence is immutable.');
    const evidenceId = `correction:${this.ids.next()}`;
    let customer = session.draft.customer;
    if (correction.customer) {
      customer = {
        name: this.correctText(customer.name, correction.customer.name, evidenceId),
        city: this.correctText(customer.city, correction.customer.city, evidenceId),
        country: this.correctText(customer.country, correction.customer.country, evidenceId),
      };
    }
    const equipment = session.draft.equipment.map((item) => {
      const change = correction.equipment?.find((candidate) => candidate.id === item.id);
      if (!change) return item;
      return {
        ...item,
        modality:
          change.modality === undefined
            ? item.modality
            : change.modality === null
              ? declaredUnknownField<Modality>([evidenceId])
              : knownField(normalizeModality(change.modality), 'Reported', [evidenceId]),
        quantity: this.correctNumber(item.quantity, change.quantity, evidenceId),
        manufacturer: this.correctText(item.manufacturer, change.manufacturer, evidenceId),
        model: this.correctText(item.model, change.model, evidenceId),
        approximateAge:
          change.approximateAgeYears === undefined
            ? item.approximateAge
            : change.approximateAgeYears === null
              ? declaredUnknownField<ExtractedEquipment['approximateAge']>([evidenceId])
              : knownField(
                  {
                    type: 'estimate' as const,
                    minYears: change.approximateAgeYears,
                    maxYears: change.approximateAgeYears,
                  },
                  'Reported',
                  [evidenceId],
                ),
        notes: this.correctText(item.notes, change.notes, evidenceId),
      };
    });
    session.draft = { ...session.draft, customer, equipment };
    this.advance(session);
    return this.view(session);
  }

  proceedToReview(id: string): CaptureSessionView {
    const session = this.requireSession(id);
    if (!requiredComplete(session.draft)) {
      throw new Error('Required capture fields must be answered or declared unknown.');
    }
    session.pendingQuestion = null;
    session.draft = { ...session.draft, state: 'READY_FOR_REVIEW' };
    return this.view(session);
  }

  save(id: string): { capture: CaptureSessionView; customerId: string } {
    const session = this.requireSession(id);
    if (session.draft.state !== 'READY_FOR_REVIEW') {
      throw new Error('Review the structured observation before saving it.');
    }
    const customerName = nullableValue(session.draft.customer.name);
    if (!customerName) throw new Error('Customer name is required to save an observation.');

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
      this.toEquipmentObservation(item, session.id, session.observedAt, evidenceIds),
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
        evidence: userMessages.map((message) => ({
          id: message.id,
          sessionId: session.id,
          source: session.source,
          capturedAt: message.createdAt,
          rawText: message.content,
        })),
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
          certainty: (value.state === 'Known' ? 'Explicit' : 'Unknown') as FactCertainty,
          evidenceIds: fieldEvidence(value),
        },
      ]),
    );
    const confidence = this.confidence.assess(
      provenanceEntries.map(([field, value]) => ({
        field,
        knowledgeState: knowledgeState(value),
        origin: fieldOrigin(value),
        certainty: (value.state === 'Known' ? 'Explicit' : 'Unknown') as FactCertainty,
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
      rawModality: null,
      quantity: nullableValue(item.quantity),
      manufacturer: nullableValue(item.manufacturer),
      model: nullableValue(item.model),
      approximateAge,
      installationEstimate: deriveInstallationEstimate(approximateAge, observedAt),
      confidence,
      status:
        approximateAge.type === 'estimate' || approximateAge.type === 'range'
          ? 'Estimated'
          : 'Reported',
      notes: nullableValue(item.notes),
      evidenceIds: collectedEvidenceIds.length > 0 ? collectedEvidenceIds : fallbackEvidenceIds,
      fieldProvenance,
    };
  }

  private mergeExtraction(
    draft: CaptureDraft,
    extraction: ObservationExtraction,
    evidenceId: string,
  ): CaptureDraft {
    const customer = {
      name: extraction.customer.name
        ? knownField(extraction.customer.name, 'Reported', [evidenceId])
        : draft.customer.name,
      city: extraction.customer.city
        ? knownField(extraction.customer.city, 'Reported', [evidenceId])
        : draft.customer.city,
      country: extraction.customer.country
        ? knownField(extraction.customer.country, 'Reported', [evidenceId])
        : draft.customer.country,
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
      return this.mergeEquipment(existing, item, evidenceId, extractionIndex);
    });
    const mergedIds = new Set(merged.map((item) => item.id));
    const equipment = [...draft.equipment.filter((item) => !mergedIds.has(item.id)), ...merged].map(
      (item, index) => ({ ...item, order: index }),
    );
    return { ...draft, customer, equipment };
  }

  private mergeEquipment(
    existing: CaptureEquipmentDraft | undefined,
    value: ExtractedEquipment,
    evidenceId: string,
    order: number,
  ): CaptureEquipmentDraft {
    return {
      id: existing?.id ?? this.ids.next(),
      order: existing?.order ?? order,
      modality: knownField(normalizeModality(value.modality), 'Reported', [evidenceId]),
      quantity:
        value.quantity === null
          ? (existing?.quantity ?? missingField<number>())
          : knownField(value.quantity, 'Reported', [evidenceId]),
      manufacturer:
        value.manufacturer === null
          ? (existing?.manufacturer ?? missingField<string>())
          : knownField(value.manufacturer, 'Reported', [evidenceId]),
      model:
        value.model === null
          ? (existing?.model ?? missingField<string>())
          : knownField(value.model, 'Reported', [evidenceId]),
      approximateAge:
        value.approximateAge.type === 'unknown'
          ? (existing?.approximateAge ?? missingField())
          : ageOrMissing(value.approximateAge, evidenceId),
      notes:
        value.notes === null
          ? (existing?.notes ?? missingField())
          : textOrUnknown(value.notes, evidenceId),
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
        customer.name = declaredUnknownField<string>([evidenceId]);
      if (question.field === 'Location') {
        if (customer.city.state === 'Missing')
          customer.city = declaredUnknownField<string>([evidenceId]);
        if (customer.country.state === 'Missing')
          customer.country = declaredUnknownField<string>([evidenceId]);
      }
      return { ...draft, customer };
    }
    if (question.target.type !== 'Equipment') return draft;
    const equipmentGroupId = question.target.equipmentGroupId;
    const equipment = draft.equipment.map((item) => {
      if (item.id !== equipmentGroupId) return item;
      if (question.field === 'Modality')
        return { ...item, modality: declaredUnknownField<Modality>([evidenceId]) };
      if (question.field === 'Quantity')
        return { ...item, quantity: declaredUnknownField<number>([evidenceId]) };
      if (question.field === 'Manufacturer')
        return { ...item, manufacturer: declaredUnknownField<string>([evidenceId]) };
      if (question.field === 'ApproximateAge')
        return {
          ...item,
          approximateAge: declaredUnknownField<ExtractedEquipment['approximateAge']>([evidenceId]),
        };
      if (question.field === 'Model')
        return { ...item, model: declaredUnknownField<string>([evidenceId]) };
      if (question.field === 'Notes')
        return { ...item, notes: declaredUnknownField<string>([evidenceId]) };
      return item;
    });
    return { ...draft, equipment };
  }

  private advance(session: MutableCaptureSession): void {
    const question = this.followUp.next(session.draft);
    session.pendingQuestion = question;
    if (question) {
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
  }

  private correctText(
    current: DraftField<string>,
    value: string | null | undefined,
    evidenceId: string,
  ): DraftField<string> {
    if (value === undefined) return current;
    return value === null || value.trim() === ''
      ? declaredUnknownField([evidenceId])
      : knownField(value.trim(), 'Reported', [evidenceId]);
  }

  private correctNumber(
    current: DraftField<number>,
    value: number | null | undefined,
    evidenceId: string,
  ): DraftField<number> {
    if (value === undefined) return current;
    return value === null
      ? declaredUnknownField([evidenceId])
      : knownField(value, 'Reported', [evidenceId]);
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
    };
  }
}
