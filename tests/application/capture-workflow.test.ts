import { describe, expect, it } from 'vitest';
import type {
  CaptureSessionView,
  Clock,
  IdGenerator,
  InferenceRuntimeInfo,
  ObservationExtractionPort,
} from '@/application';
import { CaptureWorkflowService, ObservationExtractionSchema } from '@/application';
import type { CaptureEquipmentDraft, DraftField } from '@/domain';
import { OBSERVATION_BASIS_QUESTION_KEY } from '@/domain';
import {
  applyDevelopmentSeed,
  DevelopmentMockObservationExtractionService,
  LocalSqliteDatabase,
  SqliteInstalledBaseRepository,
} from '@/infrastructure';

class FixedClock implements Clock {
  now(): string {
    return '2026-09-08T12:00:00.000Z';
  }
}

class SequenceIds implements IdGenerator {
  private value = 0;
  next(): string {
    this.value += 1;
    return `generated-${this.value}`;
  }
}

const createHarness = (
  extractor: ObservationExtractionPort = new DevelopmentMockObservationExtractionService(),
) => {
  const database = new LocalSqliteDatabase(':memory:');
  const repository = new SqliteInstalledBaseRepository(database);
  applyDevelopmentSeed(repository);
  const service = new CaptureWorkflowService(
    extractor,
    repository,
    new FixedClock(),
    new SequenceIds(),
  );
  return { database, repository, service };
};

const fixedExtractor = (value: unknown): ObservationExtractionPort => {
  const extraction = ObservationExtractionSchema.parse(value);
  const runtime: InferenceRuntimeInfo = {
    engine: 'Development Mock',
    execution: 'Development only',
    model: 'Fixed test extraction',
    networkRequiredForInference: false,
    status: 'ready',
    detail: 'Test double.',
    progressPercent: 100,
  };
  return {
    kind: 'development-mock',
    initialize: async () => runtime,
    getRuntimeInfo: () => runtime,
    extract: async () => extraction,
    dispose: async () => undefined,
  };
};

const extraction = (
  equipment: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  customer: {
    name: 'Hospital Certainty Lab',
    city: 'Panama City',
    country: 'Panama',
  },
  equipment: [
    {
      rawModality: null,
      quantity: 1,
      manufacturer: null,
      model: null,
      approximateAge: { type: 'unknown' },
      notes: null,
      ...equipment,
    },
  ],
});

const advanceToManufacturerQuestion = async (service: CaptureWorkflowService): Promise<string> => {
  const started = service.start({
    observerId: 'new-observer',
    observedAt: '2026-09-08T12:00:00Z',
  });
  const extracted = await service.submitMessage(
    started.id,
    'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
  );
  expect(extracted.pendingQuestion?.field).toBe('Manufacturer');
  return started.id;
};

describe('CaptureWorkflowService', () => {
  it('preserves uncertain model certainty through draft, provenance and persisted confidence', async () => {
    const { database, repository, service } = createHarness(
      fixedExtractor(
        extraction({
          modality: 'MR',
          rawModality: 'resonador magnético',
          approximateAge: { type: 'estimate', minYears: 7, maxYears: 9 },
          certainty: 'Uncertain',
        }),
      ),
    );
    try {
      const started = service.start();
      const captured = await service.submitMessage(started.id, 'Test evidence.');
      expect(captured.draft.equipment[0]?.modality).toEqual(
        expect.objectContaining({ certainty: 'Uncertain', value: 'MR' }),
      );
      expect(captured.draft.equipment[0]?.rawModality).toBe('resonador magnético');

      service.proceedToReview(started.id);
      service.confirmReview(started.id);
      const saved = service.save(started.id);
      const row = database.connection
        .prepare(
          `SELECT modality, raw_modality, confidence_json, field_provenance_json
           FROM equipment_observations WHERE session_id = ?`,
        )
        .get(started.id) as {
        modality: string;
        raw_modality: string | null;
        confidence_json: string;
        field_provenance_json: string;
      };
      const confidence = JSON.parse(row.confidence_json) as {
        reasons: Array<{ code: string }>;
      };
      const provenance = JSON.parse(row.field_provenance_json) as {
        modality: { certainty: string | null };
      };
      expect(row).toEqual(
        expect.objectContaining({ modality: 'MR', raw_modality: 'resonador magnético' }),
      );
      expect(provenance.modality.certainty).toBe('Uncertain');
      expect(confidence.reasons).toContainEqual(
        expect.objectContaining({ code: 'UNCERTAINTY_LANGUAGE' }),
      );
      expect(
        repository.getCustomer360(saved.customerId, new FixedClock().now())?.installedBase[0],
      ).toEqual(
        expect.objectContaining({
          modality: 'MR',
          confidence: expect.objectContaining({
            reasons: expect.arrayContaining([
              expect.objectContaining({ code: 'UNCERTAINTY_LANGUAGE' }),
            ]),
          }),
        }),
      );
    } finally {
      database.close();
    }
  });

  it('persists null certainty when extraction supplies none and does not add uncertainty reasons', async () => {
    const { database, service } = createHarness(
      fixedExtractor(extraction({ modality: 'MR', rawModality: 'MRI' })),
    );
    try {
      const started = service.start();
      const captured = await service.submitMessage(started.id, 'Test evidence.');
      expect(captured.draft.equipment[0]?.modality).toEqual(
        expect.objectContaining({ certainty: null, value: 'MR' }),
      );

      service.proceedToReview(started.id);
      service.confirmReview(started.id);
      service.save(started.id);
      const row = database.connection
        .prepare(
          `SELECT confidence_json, field_provenance_json
           FROM equipment_observations WHERE session_id = ?`,
        )
        .get(started.id) as { confidence_json: string; field_provenance_json: string };
      const confidence = JSON.parse(row.confidence_json) as {
        reasons: Array<{ code: string }>;
      };
      const provenance = JSON.parse(row.field_provenance_json) as {
        modality: { certainty: string | null };
      };
      expect(provenance.modality.certainty).toBeNull();
      expect(confidence.reasons).not.toContainEqual(
        expect.objectContaining({ code: 'UNCERTAINTY_LANGUAGE' }),
      );
      expect(confidence.reasons).not.toContainEqual(
        expect.objectContaining({ code: 'EXPLICIT_FACTS' }),
      );
    } finally {
      database.close();
    }
  });

  it.each([
    ['igt', 'Image Guided Therapy'],
    ['equipo experimental', 'Unknown'],
  ] as const)(
    'round-trips raw modality %s beside normalized modality %s',
    async (rawModality, modality) => {
      const { database, service } = createHarness(
        fixedExtractor(extraction({ modality, rawModality, certainty: 'Explicit' })),
      );
      try {
        const started = service.start();
        const captured = await service.submitMessage(started.id, 'Test evidence.');
        expect(captured.draft.equipment[0]).toEqual(
          expect.objectContaining({
            rawModality,
            modality: expect.objectContaining({ value: modality }),
          }),
        );

        service.proceedToReview(started.id);
        service.confirmReview(started.id);
        service.save(started.id);
        const row = database.connection
          .prepare(`SELECT modality, raw_modality FROM equipment_observations WHERE session_id = ?`)
          .get(started.id);
        expect(row).toEqual({ modality, raw_modality: rawModality });
      } finally {
        database.close();
      }
    },
  );

  it('does not add an uncertainty reason for an explicit extraction', async () => {
    const { database, service } = createHarness(
      fixedExtractor(
        extraction({ modality: 'CT', rawModality: 'tomógrafo', certainty: 'Explicit' }),
      ),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Test evidence.');
      service.proceedToReview(started.id);
      service.confirmReview(started.id);
      service.save(started.id);
      const row = database.connection
        .prepare('SELECT confidence_json FROM equipment_observations WHERE session_id = ?')
        .get(started.id) as { confidence_json: string };
      const confidence = JSON.parse(row.confidence_json) as {
        reasons: Array<{ code: string }>;
      };
      expect(confidence.reasons).toContainEqual(
        expect.objectContaining({ code: 'EXPLICIT_FACTS' }),
      );
      expect(confidence.reasons).not.toContainEqual(
        expect.objectContaining({ code: 'UNCERTAINTY_LANGUAGE' }),
      );
    } finally {
      database.close();
    }
  });

  it('runs extraction, acknowledges unknown and saves append-only evidence for Customer 360', async () => {
    const { database, repository, service } = createHarness();
    try {
      const started = service.start({
        observerId: 'new-observer',
        observedAt: '2026-09-08T12:00:00Z',
      });
      const extracted = await service.submitMessage(
        started.id,
        'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
      );
      expect(extracted.draft.equipment.map((item) => item.modality)).toEqual([
        expect.objectContaining({ state: 'Known', value: 'MR' }),
        expect.objectContaining({ state: 'Known', value: 'CT' }),
      ]);
      expect(extracted.pendingQuestion?.field).toBe('Manufacturer');

      const unknown = await service.submitMessage(started.id, "I don't know the manufacturer.");
      expect(unknown.draft.equipment[0]?.manufacturer.state).toBe('DeclaredUnknown');
      expect(unknown.pendingQuestion?.field).toBe('ApproximateAge');

      const review = service.proceedToReview(started.id);
      service.confirmReview(started.id);
      expect(review.draft.state).toBe('READY_FOR_REVIEW');
      const saved = service.save(started.id);
      expect(saved.capture.draft.state).toBe('SAVED');

      const rawSessions = database.connection
        .prepare('SELECT COUNT(*) AS count FROM observation_sessions WHERE customer_id = ?')
        .get(saved.customerId) as { count: number };
      expect(rawSessions.count).toBe(2);
      const view = repository.getCustomer360(saved.customerId, '2026-09-08T12:00:00Z');
      expect(view?.evidence.some((item) => item.observerName === 'Demo Collaborator')).toBe(true);
      const persisted = database.connection
        .prepare('SELECT field_provenance_json FROM equipment_observations WHERE session_id = ?')
        .get(started.id) as { field_provenance_json: string };
      const provenance = JSON.parse(persisted.field_provenance_json) as {
        manufacturer: { certainty: string | null };
        model: { certainty: string | null };
      };
      expect(provenance.manufacturer.certainty).toBe('Unknown');
      expect(provenance.model.certainty).toBe('Unknown');
    } finally {
      database.close();
    }
  });

  it.each([
    'no lo sé',
    'no lo se',
    'ni idea',
    'no estoy seguro',
    'no estoy segura',
    'no me fijé',
    'no sabría decir',
    'ni idea la verdad',
    'no sé',
    'no se',
    "I don't know",
    'I do not know',
    'unknown',
    'not sure',
    'desconocido',
    'desconocida',
  ])('treats "%s" as a declared-unknown reply', async (reply) => {
    const { database, service } = createHarness();
    try {
      const sessionId = await advanceToManufacturerQuestion(service);

      const result = await service.submitMessage(sessionId, reply);

      expect(result.draft.equipment[0]?.manufacturer.state).toBe('DeclaredUnknown');
      expect(result.pendingQuestion?.field).toBe('ApproximateAge');
    } finally {
      database.close();
    }
  });

  it('does not treat a manufacturer correction containing a negation as unknown', async () => {
    const { database, service } = createHarness();
    try {
      const sessionId = await advanceToManufacturerQuestion(service);
      await service.submitMessage(sessionId, 'no sé');
      const ctManufacturerQuestion = await service.submitMessage(sessionId, '8');
      expect(ctManufacturerQuestion.pendingQuestion?.field).toBe('Manufacturer');

      const result = await service.submitMessage(sessionId, 'no es NovaMed, es Orion Imaging');

      const ctEquipment = result.draft.equipment.find(
        (item) => item.modality.state === 'Known' && item.modality.value === 'CT',
      );
      expect(ctEquipment?.manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'Orion Imaging' }),
      );
    } finally {
      database.close();
    }
  });

  it('treats an isolated "no" as declared unknown for a Do you know model follow-up', async () => {
    const { database, service } = createHarness();
    try {
      const sessionId = await advanceToManufacturerQuestion(service);
      let result = await service.submitMessage(sessionId, 'no sé');
      result = await service.submitMessage(sessionId, '8');
      result = await service.submitMessage(sessionId, 'no sé');
      result = await service.submitMessage(sessionId, '8');
      expect(result.pendingQuestion?.field).toBe('ObservationBasis');
      result = await service.submitMessage(sessionId, 'los vi directamente');
      expect(result.pendingQuestion?.field).toBe('Model');
      expect(result.pendingQuestion?.target.type).toBe('Equipment');
      const targetId =
        result.pendingQuestion?.target.type === 'Equipment'
          ? result.pendingQuestion.target.equipmentGroupId
          : null;

      result = await service.submitMessage(sessionId, 'no');

      expect(result.draft.equipment.find((item) => item.id === targetId)?.model.state).toBe(
        'DeclaredUnknown',
      );
      expect(result.pendingQuestion?.key).not.toBe(`equipment:${targetId}:Model`);
    } finally {
      database.close();
    }
  });

  it('does not treat an isolated "no" as unknown for another kind of follow-up', async () => {
    const { database, service } = createHarness();
    try {
      const started = service.start();
      const missingCustomer = await service.submitMessage(started.id, 'They have two MR systems.');
      expect(missingCustomer.pendingQuestion?.text).toBe('¿Qué hospital o clínica visitó?');

      const result = await service.submitMessage(started.id, 'no');

      expect(result.draft.customer.name).toEqual(expect.objectContaining({ state: 'Known' }));
    } finally {
      database.close();
    }
  });
});

describe('CaptureWorkflowService modality correction', () => {
  it('stores a corrected modality exactly as selected from the official vocabulary', async () => {
    const { database, repository, service } = createHarness();
    try {
      const started = service.start({
        observerId: 'new-observer',
        observedAt: '2026-09-08T12:00:00Z',
      });
      const extracted = await service.submitMessage(
        started.id,
        'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
      );
      const groupId = extracted.draft.equipment[0]?.id;
      expect(groupId).toBeDefined();

      const corrected = service.correct(started.id, {
        equipment: [{ id: String(groupId), modality: 'Image Guided Therapy' }],
      });

      expect(corrected.draft.equipment[0]?.modality).toEqual(
        expect.objectContaining({ state: 'Known', value: 'Image Guided Therapy' }),
      );

      service.proceedToReview(started.id);
      service.confirmReview(started.id);
      const saved = service.save(started.id);
      const view = repository.getCustomer360(saved.customerId, '2026-09-08T12:00:00Z');
      expect(view?.installedBase.some((item) => item.modality === 'Image Guided Therapy')).toBe(
        true,
      );

      const correctionEvidence = database.connection
        .prepare("SELECT COUNT(*) AS count FROM evidence_items WHERE id LIKE 'correction:%'")
        .get() as { count: number };
      expect(correctionEvidence.count).toBe(1);
    } finally {
      database.close();
    }
  });

  it('keeps an unrecognised corrected modality as Unknown rather than guessing', async () => {
    const { database, service } = createHarness();
    try {
      const started = service.start();
      const extracted = await service.submitMessage(
        started.id,
        'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
      );
      const groupId = String(extracted.draft.equipment[0]?.id);

      const corrected = service.correct(started.id, {
        equipment: [{ id: groupId, modality: 'some unlisted device' }],
      });

      expect(corrected.draft.equipment[0]?.modality).toEqual(
        expect.objectContaining({ state: 'Known', value: 'Unknown' }),
      );
    } finally {
      database.close();
    }
  });
});

describe('CaptureWorkflowService correction preserves existing ages (P3-S2)', () => {
  const captureWithAge = async (
    approximateAge: Readonly<Record<string, unknown>>,
  ): Promise<{
    database: ReturnType<typeof createHarness>['database'];
    repository: ReturnType<typeof createHarness>['repository'];
    service: CaptureWorkflowService;
    sessionId: string;
    groupId: string;
  }> => {
    const { database, repository, service } = createHarness(
      fixedExtractor(
        extraction({
          modality: 'MR',
          manufacturer: 'NovaMed',
          approximateAge,
          certainty: 'Uncertain',
        }),
      ),
    );
    const started = service.start();
    const captured = await service.submitMessage(started.id, 'Test evidence.');
    const groupId = String(captured.draft.equipment[0]?.id);
    return { database, repository, service, sessionId: started.id, groupId };
  };

  it('leaves a qualitative age untouched when the correction does not mention age', async () => {
    const { database, service, sessionId, groupId } = await captureWithAge({
      type: 'qualitative',
      label: 'bastante nuevo',
    });
    try {
      const corrected = service.correct(sessionId, {
        customer: { name: 'Hospital Certainty Lab Renamed' },
      });
      const equipment = corrected.draft.equipment.find((item) => item.id === groupId);
      expect(equipment?.approximateAge).toEqual(
        expect.objectContaining({
          state: 'Known',
          value: { type: 'qualitative', label: 'bastante nuevo' },
        }),
      );
    } finally {
      database.close();
    }
  });

  it('preserves a qualitative age while correcting the manufacturer', async () => {
    const { database, service, sessionId, groupId } = await captureWithAge({
      type: 'qualitative',
      label: 'bastante nuevo',
    });
    try {
      const corrected = service.correct(sessionId, {
        equipment: [{ id: groupId, manufacturer: 'Orion Imaging' }],
      });
      const equipment = corrected.draft.equipment.find((item) => item.id === groupId);
      expect(equipment?.manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'Orion Imaging' }),
      );
      expect(equipment?.approximateAge).toEqual(
        expect.objectContaining({
          state: 'Known',
          value: { type: 'qualitative', label: 'bastante nuevo' },
        }),
      );
    } finally {
      database.close();
    }
  });

  it('preserves a qualitative age while correcting the modality', async () => {
    const { database, service, sessionId, groupId } = await captureWithAge({
      type: 'qualitative',
      label: 'parece bastante nuevo',
    });
    try {
      const corrected = service.correct(sessionId, {
        equipment: [{ id: groupId, modality: 'CT' }],
      });
      const equipment = corrected.draft.equipment.find((item) => item.id === groupId);
      expect(equipment?.modality).toEqual(expect.objectContaining({ state: 'Known', value: 'CT' }));
      expect(equipment?.approximateAge).toEqual(
        expect.objectContaining({
          state: 'Known',
          value: { type: 'qualitative', label: 'parece bastante nuevo' },
        }),
      );
    } finally {
      database.close();
    }
  });

  it('replaces a qualitative age with an exact age, not an estimate, when explicitly corrected', async () => {
    const { database, service, sessionId, groupId } = await captureWithAge({
      type: 'qualitative',
      label: 'bastante nuevo',
    });
    try {
      const corrected = service.correct(sessionId, {
        equipment: [{ id: groupId, approximateAgeYears: 5 }],
      });
      const equipment = corrected.draft.equipment.find((item) => item.id === groupId);
      expect(equipment?.approximateAge).toEqual(
        expect.objectContaining({ state: 'Known', value: { type: 'exact', years: 5 } }),
      );
    } finally {
      database.close();
    }
  });

  it('marks the age declared unknown when a qualitative age is explicitly cleared', async () => {
    const { database, service, sessionId, groupId } = await captureWithAge({
      type: 'qualitative',
      label: 'bastante nuevo',
    });
    try {
      const corrected = service.correct(sessionId, {
        equipment: [{ id: groupId, approximateAgeYears: null }],
      });
      const equipment = corrected.draft.equipment.find((item) => item.id === groupId);
      expect(equipment?.approximateAge.state).toBe('DeclaredUnknown');
    } finally {
      database.close();
    }
  });

  it('preserves an existing numeric estimate range while correcting another field', async () => {
    const { database, service, sessionId, groupId } = await captureWithAge({
      type: 'estimate',
      minYears: 7,
      maxYears: 9,
    });
    try {
      const corrected = service.correct(sessionId, {
        equipment: [{ id: groupId, manufacturer: 'Orion Imaging' }],
      });
      const equipment = corrected.draft.equipment.find((item) => item.id === groupId);
      expect(equipment?.approximateAge).toEqual(
        expect.objectContaining({
          state: 'Known',
          value: { type: 'estimate', minYears: 7, maxYears: 9 },
        }),
      );
    } finally {
      database.close();
    }
  });

  it('leaves a missing age missing when correcting another field', async () => {
    const { database, service, sessionId, groupId } = await captureWithAge({ type: 'unknown' });
    try {
      const corrected = service.correct(sessionId, {
        equipment: [{ id: groupId, manufacturer: 'Orion Imaging' }],
      });
      const equipment = corrected.draft.equipment.find((item) => item.id === groupId);
      expect(equipment?.approximateAge.state).toBe('Missing');
    } finally {
      database.close();
    }
  });

  it('leaves a declared-unknown age unchanged when correcting another field', async () => {
    const { database, service } = createHarness();
    try {
      const started = service.start({
        observerId: 'new-observer',
        observedAt: '2026-09-08T12:00:00Z',
      });
      const extracted = await service.submitMessage(
        started.id,
        'I am at Hospital DemoCare Pacific in Panama. They have one MR system.',
      );
      expect(extracted.pendingQuestion?.field).toBe('Manufacturer');

      const afterManufacturer = await service.submitMessage(started.id, 'no sé');
      expect(afterManufacturer.draft.equipment[0]?.manufacturer.state).toBe('DeclaredUnknown');
      expect(afterManufacturer.pendingQuestion?.field).toBe('ApproximateAge');

      const afterAge = await service.submitMessage(started.id, 'no sé');
      expect(afterAge.draft.equipment[0]?.approximateAge.state).toBe('DeclaredUnknown');
      const groupId = String(afterAge.draft.equipment[0]?.id);

      const corrected = service.correct(started.id, {
        customer: { name: 'Hospital Renamed' },
      });
      expect(
        corrected.draft.equipment.find((item) => item.id === groupId)?.approximateAge.state,
      ).toBe('DeclaredUnknown');
    } finally {
      database.close();
    }
  });

  it('round-trips a preserved qualitative age through save, persistence and Customer 360', async () => {
    const { database, repository, service, sessionId, groupId } = await captureWithAge({
      type: 'qualitative',
      label: 'bastante nuevo',
    });
    try {
      service.correct(sessionId, {
        equipment: [{ id: groupId, manufacturer: 'Orion Imaging' }],
      });
      service.proceedToReview(sessionId);
      service.confirmReview(sessionId);
      const saved = service.save(sessionId);

      const row = database.connection
        .prepare('SELECT approximate_age_json FROM equipment_observations WHERE session_id = ?')
        .get(sessionId) as { approximate_age_json: string };
      expect(JSON.parse(row.approximate_age_json)).toEqual({
        type: 'qualitative',
        label: 'bastante nuevo',
      });

      const view = repository.getCustomer360(saved.customerId, '2026-09-08T12:00:00Z');
      expect(view?.installedBase[0]?.approximateAge).toEqual({
        type: 'qualitative',
        label: 'bastante nuevo',
      });
    } finally {
      database.close();
    }
  });
});

describe('CaptureWorkflowService observation status (P3-S3)', () => {
  const captureAndSave = async (
    text: string,
  ): Promise<{ status: string; certainty: string | null }> => {
    const { database, service } = createHarness();
    try {
      const started = service.start();
      await service.submitMessage(started.id, text);
      service.proceedToReview(started.id);
      service.confirmReview(started.id);
      service.save(started.id);
      const row = database.connection
        .prepare(
          'SELECT status, field_provenance_json FROM equipment_observations WHERE session_id = ?',
        )
        .get(started.id) as { status: string; field_provenance_json: string };
      const provenance = JSON.parse(row.field_provenance_json) as {
        approximateAge: { certainty: string | null };
      };
      return { status: row.status, certainty: provenance.approximateAge.certainty };
    } finally {
      database.close();
    }
  };

  it('records a directly observed capture as Confirmed', async () => {
    const result = await captureAndSave(
      'Estoy en el Hospital DemoCare Pacific en Panama. Vi directamente dos MR de NovaMed.',
    );
    expect(result.status).toBe('Confirmed');
  });

  it('records information relayed by someone else as Reported', async () => {
    const result = await captureAndSave(
      'Estoy en el Hospital DemoCare Pacific en Panama. El tecnico me dijo que tienen dos MR.',
    );
    expect(result.status).toBe('Reported');
  });

  it('records an openly estimated account as Estimated', async () => {
    const result = await captureAndSave(
      'Estoy en el Hospital DemoCare Pacific en Panama. Creo que tienen dos MR.',
    );
    expect(result.status).toBe('Estimated');
  });

  it('keeps a directly observed capture Confirmed even when the age is uncertain', async () => {
    const result = await captureAndSave(
      'Estoy en el Hospital DemoCare Pacific en Panama. Vi directamente dos MR de unos ocho anos.',
    );
    expect(result.status).toBe('Confirmed');
    expect(result.certainty).toBe('Uncertain');
  });

  it('keeps a reported capture Reported even when the age is stated exactly', async () => {
    const result = await captureAndSave(
      'Estoy en el Hospital DemoCare Pacific en Panama. Me dijeron que tienen dos MR de 8 anos.',
    );
    expect(result.status).toBe('Reported');
    expect(result.certainty).toBe('Explicit');
  });

  it('asks how the equipment was observed when the capture does not say', async () => {
    const { database, service } = createHarness();
    try {
      const started = service.start();
      await service.submitMessage(
        started.id,
        'Estoy en el Hospital DemoCare Pacific en Panama. Tienen dos MR.',
      );
      const afterManufacturer = await service.submitMessage(started.id, 'no lo se');
      expect(afterManufacturer.pendingQuestion?.field).toBe('ApproximateAge');
      const afterAge = await service.submitMessage(started.id, 'no lo se');

      expect(afterAge.pendingQuestion?.key).toBe(OBSERVATION_BASIS_QUESTION_KEY);
      expect(afterAge.pendingQuestion?.priority).toBe('Preferred');
      expect(afterAge.draft.observationBasis.state).toBe('Missing');
    } finally {
      database.close();
    }
  });

  it('accepts a declined provenance question as Unknown and never fabricates Confirmed', async () => {
    const { database, service } = createHarness();
    try {
      const started = service.start();
      await service.submitMessage(
        started.id,
        'Estoy en el Hospital DemoCare Pacific en Panama. Tienen dos MR.',
      );
      await service.submitMessage(started.id, 'no lo se');
      const afterAge = await service.submitMessage(started.id, 'no lo se');
      expect(afterAge.pendingQuestion?.key).toBe(OBSERVATION_BASIS_QUESTION_KEY);

      const declined = await service.submitMessage(started.id, 'no lo se');

      expect(declined.draft.observationBasis.state).toBe('DeclaredUnknown');
      expect(declined.pendingQuestion?.key).not.toBe(OBSERVATION_BASIS_QUESTION_KEY);
      expect(declined.draft.observationBasis).not.toEqual(
        expect.objectContaining({ state: 'Known' }),
      );

      service.proceedToReview(started.id);
      service.confirmReview(started.id);
      service.save(started.id);
      const row = database.connection
        .prepare('SELECT status FROM equipment_observations WHERE session_id = ?')
        .get(started.id) as { status: string };
      expect(row.status).toBe('Unknown');
      expect(row.status).not.toBe('Confirmed');
    } finally {
      database.close();
    }
  });
});

describe('CaptureWorkflowService review confirmation (P3-S3)', () => {
  const readyCapture = async (): Promise<{
    database: ReturnType<typeof createHarness>['database'];
    repository: ReturnType<typeof createHarness>['repository'];
    service: CaptureWorkflowService;
    sessionId: string;
  }> => {
    const { database, repository, service } = createHarness();
    const started = service.start();
    await service.submitMessage(
      started.id,
      'Vi directamente dos MR de NovaMed en el Hospital DemoCare Pacific en Panama.',
    );
    return { database, repository, service, sessionId: started.id };
  };

  it('reads the draft back and asks for confirmation when no follow-up remains', async () => {
    const { database, service, sessionId } = await readyCapture();
    try {
      const review = service.proceedToReview(sessionId);

      const summary = review.messages.at(-1);
      expect(summary?.role).toBe('Assistant');
      expect(summary?.content).toContain('¿Es correcto?');
      expect(summary?.content).toContain('MR');
      expect(review.reviewConfirmed).toBe(false);
    } finally {
      database.close();
    }
  });

  it('does not treat reaching review as a confirmation', async () => {
    const { database, service, sessionId } = await readyCapture();
    try {
      const review = service.proceedToReview(sessionId);

      expect(review.draft.state).toBe('READY_FOR_REVIEW');
      expect(review.reviewConfirmed).toBe(false);
      expect(() => service.save(sessionId)).toThrow();
    } finally {
      database.close();
    }
  });

  it('persists the observation once the observer confirms in the conversation', async () => {
    const { database, service, sessionId } = await readyCapture();
    try {
      service.proceedToReview(sessionId);

      const confirmed = await service.submitMessage(sessionId, 'si, es correcto');

      expect(confirmed.reviewConfirmed).toBe(true);
      expect(confirmed.draft.state).toBe('READY_FOR_REVIEW');
      expect(() => service.save(sessionId)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it('persists the observation once the observer confirms through the explicit action', async () => {
    const { database, service, sessionId } = await readyCapture();
    try {
      service.proceedToReview(sessionId);

      const confirmed = service.confirmReview(sessionId);

      expect(confirmed.reviewConfirmed).toBe(true);
      expect(() => service.save(sessionId)).not.toThrow();

      const confirmationEvidence = database.connection
        .prepare("SELECT COUNT(*) AS count FROM evidence_items WHERE id LIKE 'confirmation:%'")
        .get() as { count: number };
      expect(confirmationEvidence.count).toBe(1);
    } finally {
      database.close();
    }
  });

  it('leaves the draft unconfirmed when the observer rejects the summary', async () => {
    const { database, service, sessionId } = await readyCapture();
    try {
      service.proceedToReview(sessionId);

      const rejected = await service.submitMessage(sessionId, 'no');

      expect(rejected.reviewConfirmed).toBe(false);
      expect(() => service.save(sessionId)).toThrow();
    } finally {
      database.close();
    }
  });

  it('withdraws a confirmation when the observer then corrects a field', async () => {
    const { database, service, sessionId } = await readyCapture();
    try {
      const review = service.proceedToReview(sessionId);
      service.confirmReview(sessionId);
      const groupId = String(review.draft.equipment[0]?.id);

      const corrected = service.correct(sessionId, {
        equipment: [{ id: groupId, manufacturer: 'Orion Imaging' }],
      });
      expect(corrected.draft.equipment[0]?.manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'Orion Imaging' }),
      );
      expect(corrected.reviewConfirmed).toBe(false);
      expect(() => service.save(sessionId)).toThrow();

      const rereview = service.proceedToReview(sessionId);
      expect(rereview.messages.at(-1)?.content).toContain('Orion Imaging');
      expect(rereview.reviewConfirmed).toBe(false);

      service.confirmReview(sessionId);
      expect(() => service.save(sessionId)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it('marks an uncertain field as uncertain in the summary it reads back', async () => {
    const { database, service } = createHarness(
      fixedExtractor(
        extraction({
          modality: 'MR',
          manufacturer: 'NovaMed',
          approximateAge: { type: 'estimate', minYears: 7, maxYears: 7 },
          certainty: 'Uncertain',
        }),
      ),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Test evidence.');
      const review = service.proceedToReview(started.id);
      expect(review.messages.at(-1)?.content).toContain('incierto');
    } finally {
      database.close();
    }
  });

  it('treats a spoken correction as a correction rather than a confirmation', async () => {
    const { database, service, sessionId } = await readyCapture();
    try {
      service.proceedToReview(sessionId);
      const result = await service.submitMessage(sessionId, 'en realidad eran tres MR');
      expect(result.reviewConfirmed).toBe(false);
      expect(result.draft.equipment[0]?.quantity).toEqual(
        expect.objectContaining({ state: 'Known', value: 3 }),
      );
    } finally {
      database.close();
    }
  });
});

describe('CaptureWorkflowService contradictions inside one capture (P3-S6)', () => {
  /** Feeds one extraction per message, so a disagreement can be staged deterministically. */
  const sequenceExtractor = (values: readonly unknown[]): ObservationExtractionPort => {
    const parsed = values.map((value) => ObservationExtractionSchema.parse(value));
    const runtime: InferenceRuntimeInfo = {
      engine: 'Development Mock',
      execution: 'Development only',
      model: 'Sequenced test extraction',
      networkRequiredForInference: false,
      status: 'ready',
      detail: 'Test double.',
      progressPercent: 100,
    };
    let index = 0;
    return {
      kind: 'development-mock',
      initialize: async () => runtime,
      getRuntimeInfo: () => runtime,
      extract: async () => {
        const value = parsed[Math.min(index, parsed.length - 1)];
        index += 1;
        if (!value) throw new Error('The test extractor ran out of extractions.');
        return value;
      },
      dispose: async () => undefined,
    };
  };

  const group = (capture: CaptureSessionView): CaptureEquipmentDraft => {
    const item = capture.draft.equipment[0];
    if (!item) throw new Error('The draft has no equipment group.');
    return item;
  };

  const lastUserEvidence = (capture: CaptureSessionView): string =>
    String(capture.messages.filter((item) => item.role === 'User').at(-1)?.id);

  const evidenceOf = (field: DraftField<unknown>): readonly string[] =>
    field.state === 'Missing' ? [] : field.evidenceIds;

  it('keeps both manufacturers traceable and asks which to keep when nothing says which is right', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', manufacturer: 'NovaMed', certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'Orion Imaging', certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      const first = await service.submitMessage(started.id, 'Vi directamente dos MR de NovaMed.');
      const firstEvidence = lastUserEvidence(first);
      const second = await service.submitMessage(started.id, 'Bueno, quiza era Orion Imaging.');
      const secondEvidence = lastUserEvidence(second);

      expect(group(second).manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'Orion Imaging', certainty: 'Uncertain' }),
      );
      expect(evidenceOf(group(second).manufacturer)).toEqual(
        expect.arrayContaining([firstEvidence, secondEvidence]),
      );
      expect(group(second).contradictions).toEqual([
        {
          field: 'Manufacturer',
          previousText: 'NovaMed',
          previousEvidenceIds: [firstEvidence],
          currentText: 'Orion Imaging',
          currentEvidenceIds: [secondEvidence],
        },
      ]);
      expect(second.pendingQuestion?.priority).toBe('Required');
      expect(second.pendingQuestion?.text).toContain('NovaMed');
      expect(second.pendingQuestion?.text).toContain('Orion Imaging');
      expect(second.draft.state).toBe('NEEDS_FOLLOW_UP');
    } finally {
      database.close();
    }
  });

  it('keeps both quantities traceable when a later count disagrees with the first', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', quantity: 2, certainty: 'Explicit' }),
        extraction({ modality: 'MR', quantity: 3, certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      const first = await service.submitMessage(started.id, 'Vi dos equipos MR.');
      const firstEvidence = lastUserEvidence(first);
      const second = await service.submitMessage(started.id, 'Creo que eran tres.');
      const secondEvidence = lastUserEvidence(second);

      expect(group(second).quantity).toEqual(
        expect.objectContaining({ state: 'Known', value: 3, certainty: 'Uncertain' }),
      );
      expect(evidenceOf(group(second).quantity)).toEqual(
        expect.arrayContaining([firstEvidence, secondEvidence]),
      );
      expect(group(second).contradictions[0]).toEqual(
        expect.objectContaining({ field: 'Quantity', previousText: '2', currentText: '3' }),
      );
    } finally {
      database.close();
    }
  });

  it('does not raise a contradiction when a later message fills a field that was missing', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', manufacturer: null, certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'NovaMed', certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Vi dos equipos MR.');
      const second = await service.submitMessage(started.id, 'Son de NovaMed.');

      expect(group(second).manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed', certainty: 'Explicit' }),
      );
      expect(group(second).contradictions).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('treats a value that follows a declared unknown as enrichment and keeps the earlier evidence', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', manufacturer: null, certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'NovaMed', certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Vi dos equipos MR.');
      const declined = await service.submitMessage(started.id, 'no lo se');
      expect(group(declined).manufacturer.state).toBe('DeclaredUnknown');
      const unknownEvidence = lastUserEvidence(declined);

      const later = await service.submitMessage(started.id, 'Ahora si, son de NovaMed.');

      expect(group(later).manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed', certainty: 'Explicit' }),
      );
      expect(evidenceOf(group(later).manufacturer)).toContain(unknownEvidence);
      expect(group(later).contradictions).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('accepts an explicit self-correction without asking, and still keeps the earlier evidence', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', quantity: 3, certainty: 'Explicit' }),
        extraction({ modality: 'MR', quantity: 2, certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      const first = await service.submitMessage(started.id, 'Vi tres equipos MR.');
      const firstEvidence = lastUserEvidence(first);

      const corrected = await service.submitMessage(
        started.id,
        'Primero pense que eran tres, pero en realidad habia dos.',
      );

      expect(group(corrected).quantity).toEqual(
        expect.objectContaining({ state: 'Known', value: 2, certainty: 'Explicit' }),
      );
      expect(evidenceOf(group(corrected).quantity)).toContain(firstEvidence);
      expect(group(corrected).contradictions).toEqual([]);
      expect(corrected.pendingQuestion?.text ?? '').not.toContain('¿Cuál debo conservar?');
    } finally {
      database.close();
    }
  });

  it('resolves the field to the answered value with an explicit certainty', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', manufacturer: 'NovaMed', certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'Orion Imaging', certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'NovaMed', certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Vi directamente dos MR de NovaMed.');
      const contradicted = await service.submitMessage(started.id, 'Quiza era Orion Imaging.');
      expect(contradicted.draft.state).toBe('NEEDS_FOLLOW_UP');
      expect(() => service.proceedToReview(started.id)).toThrow(/contradictoria/i);

      const resolved = await service.submitMessage(started.id, 'NovaMed');

      expect(group(resolved).manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed', certainty: 'Explicit' }),
      );
      expect(group(resolved).contradictions).toEqual([]);
      expect(resolved.pendingQuestion?.text ?? '').not.toContain('¿Cuál debo conservar?');
    } finally {
      database.close();
    }
  });

  it('does not let a confirmation settle a contradiction raised after it', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', manufacturer: 'NovaMed', certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'Orion Imaging', certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Vi directamente dos MR de NovaMed.');
      service.proceedToReview(started.id);
      expect(service.confirmReview(started.id).reviewConfirmed).toBe(true);

      const contradicted = await service.submitMessage(started.id, 'Quiza era Orion Imaging.');

      expect(contradicted.reviewConfirmed).toBe(false);
      expect(contradicted.draft.state).toBe('NEEDS_FOLLOW_UP');
      expect(group(contradicted).contradictions).toHaveLength(1);
      expect(() => service.save(started.id)).toThrow();
      expect(() => service.confirmReview(started.id)).toThrow();
    } finally {
      database.close();
    }
  });

  it('keeps a corrected modality traceable to the earlier claim and preserves the raw wording', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([extraction({ modality: 'MR', rawModality: 'resonadores' })]),
    );
    try {
      const started = service.start();
      const first = await service.submitMessage(started.id, 'Me dijeron que eran dos resonadores.');
      const firstEvidence = lastUserEvidence(first);

      const corrected = service.correct(started.id, {
        equipment: [{ id: group(first).id, modality: 'CT' }],
      });

      expect(group(corrected).modality).toEqual(
        expect.objectContaining({ state: 'Known', value: 'CT' }),
      );
      expect(evidenceOf(group(corrected).modality)).toEqual(
        expect.arrayContaining([firstEvidence]),
      );
      expect(group(corrected).rawModality).toBe('resonadores');
      expect(corrected.reviewConfirmed).toBe(false);
    } finally {
      database.close();
    }
  });

  it('keeps both claims traceable through save, reload and Customer 360', async () => {
    const { database, repository, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', manufacturer: 'NovaMed', certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'Orion Imaging', certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'Orion Imaging', certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      const first = await service.submitMessage(started.id, 'Vi directamente dos MR de NovaMed.');
      const firstEvidence = lastUserEvidence(first);
      const second = await service.submitMessage(started.id, 'Quiza era Orion Imaging.');
      const secondEvidence = lastUserEvidence(second);
      const answered = await service.submitMessage(started.id, 'Orion Imaging');
      expect(group(answered).contradictions).toEqual([]);

      service.proceedToReview(started.id);
      service.confirmReview(started.id);
      const saved = service.save(started.id);

      const row = database.connection
        .prepare('SELECT field_provenance_json FROM equipment_observations WHERE session_id = ?')
        .get(started.id) as { field_provenance_json: string };
      const provenance = JSON.parse(row.field_provenance_json) as {
        manufacturer: { evidenceIds: string[] };
      };
      expect(provenance.manufacturer.evidenceIds).toEqual(
        expect.arrayContaining([firstEvidence, secondEvidence]),
      );

      const view = repository.getCustomer360(saved.customerId, '2026-09-08T12:00:00Z');
      const rawText = (view?.evidence ?? []).map((item) => item.rawInput ?? '').join(' ');
      expect(rawText).toContain('NovaMed');
      expect(rawText).toContain('Orion Imaging');
      expect(view?.installedBase.length ?? 0).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });

  it('never turns a contradiction into a duplicate candidate', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([
        extraction({ modality: 'MR', manufacturer: 'NovaMed', certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'Orion Imaging', certainty: 'Explicit' }),
        extraction({ modality: 'MR', manufacturer: 'Orion Imaging', certainty: 'Explicit' }),
      ]),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Vi directamente dos MR de NovaMed.');
      await service.submitMessage(started.id, 'Quiza era Orion Imaging.');
      await service.submitMessage(started.id, 'Orion Imaging');
      service.proceedToReview(started.id);
      service.confirmReview(started.id);
      service.save(started.id);

      const candidates = database.connection
        .prepare(
          'SELECT COUNT(*) AS count FROM duplicate_candidates WHERE source_observation_id IN (SELECT id FROM equipment_observations WHERE session_id = ?)',
        )
        .get(started.id) as { count: number };
      expect(candidates.count).toBe(0);
    } finally {
      database.close();
    }
  });
});

describe('CaptureWorkflowService pending-answer multi-field merge', () => {
  /**
   * Establishes a precondition (a specific field left Missing) with one fixed extraction, then
   * hands every later turn to a real `DevelopmentMockObservationExtractionService`, so the actual
   * fix under test — the mock's own answer parsing — is what is exercised for the answer being
   * tested, not a second canned response.
   */
  const primeThenRealMock = (primer: unknown): ObservationExtractionPort => {
    const real = new DevelopmentMockObservationExtractionService();
    const primed = ObservationExtractionSchema.parse(primer);
    let primedTurnRemaining = true;
    return {
      kind: 'development-mock',
      initialize: () => real.initialize(),
      getRuntimeInfo: () => real.getRuntimeInfo(),
      extract: async (text, context) => {
        if (primedTurnRemaining) {
          primedTurnRemaining = false;
          return primed;
        }
        return real.extract(text, context);
      },
      dispose: () => real.dispose(),
    };
  };

  const group = (capture: CaptureSessionView): CaptureEquipmentDraft => {
    const item = capture.draft.equipment[0];
    if (!item) throw new Error('The draft has no equipment group.');
    return item;
  };

  it('preserves an incidentally-mentioned age while answering a quantity question', async () => {
    const { database, service } = createHarness(
      primeThenRealMock(extraction({ modality: 'CT', quantity: null, certainty: 'Explicit' })),
    );
    try {
      const started = service.start();
      const primed = await service.submitMessage(started.id, 'Tienen tomógrafos.');
      expect(primed.pendingQuestion?.field).toBe('Quantity');

      const answered = await service.submitMessage(started.id, '3, y tenían alrededor de 7 años');

      expect(group(answered).quantity).toEqual(
        expect.objectContaining({ state: 'Known', value: 3 }),
      );
      expect(group(answered).approximateAge).toEqual(
        expect.objectContaining({
          state: 'Known',
          value: { type: 'estimate', minYears: 7, maxYears: 7 },
        }),
      );
    } finally {
      database.close();
    }
  });

  it('preserves a manufacturer, model and age all volunteered in one manufacturer answer', async () => {
    const { database, service } = createHarness(
      primeThenRealMock(extraction({ modality: 'MR', quantity: 2, certainty: 'Explicit' })),
    );
    try {
      const started = service.start();
      const primed = await service.submitMessage(started.id, 'Vi dos resonadores.');
      expect(primed.pendingQuestion?.field).toBe('Manufacturer');

      const answered = await service.submitMessage(
        started.id,
        'Son NovaMed, modelo NM-300, de unos ocho años',
      );

      expect(group(answered).manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed' }),
      );
      expect(group(answered).model).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NM-300' }),
      );
      expect(group(answered).approximateAge).toEqual(
        expect.objectContaining({
          state: 'Known',
          value: { type: 'estimate', minYears: 8, maxYears: 8 },
        }),
      );
    } finally {
      database.close();
    }
  });

  it('still answers a bare short reply ("3") without inventing an age from nothing', async () => {
    const { database, service } = createHarness(
      primeThenRealMock(extraction({ modality: 'CT', quantity: null, certainty: 'Explicit' })),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Tienen tomógrafos.');

      const answered = await service.submitMessage(started.id, '3');

      expect(group(answered).quantity).toEqual(
        expect.objectContaining({ state: 'Known', value: 3 }),
      );
      expect(group(answered).approximateAge.state).toBe('Missing');
    } finally {
      database.close();
    }
  });

  it('still treats a bare "No" as a declared unknown for the field actually pending', async () => {
    const { database, service } = createHarness();
    try {
      const started = service.start();
      await service.submitMessage(
        started.id,
        'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
      );
      const declined = await service.submitMessage(started.id, 'No');

      expect(declined.draft.equipment[0]?.manufacturer.state).toBe('DeclaredUnknown');
    } finally {
      database.close();
    }
  });

  it('does not re-ask about a field the same turn already answered', async () => {
    const { database, service } = createHarness(
      primeThenRealMock(extraction({ modality: 'CT', quantity: null, certainty: 'Explicit' })),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Tienen tomógrafos.');

      const answered = await service.submitMessage(started.id, '3, y tenían alrededor de 7 años');

      // Age was volunteered alongside quantity, so the next gap is manufacturer, never age again.
      expect(answered.pendingQuestion?.field).not.toBe('ApproximateAge');
      expect(answered.pendingQuestion?.field).toBe('Manufacturer');
    } finally {
      database.close();
    }
  });

  it('still raises a contradiction (P3-S6) for a manufacturer volunteered inside another answer, never a silent overwrite', async () => {
    const { database, service } = createHarness();
    try {
      const started = service.start();
      await service.submitMessage(
        started.id,
        'Vi un MR en el Hospital DemoCare Pacific en Panama.',
      );
      const afterManufacturer = await service.submitMessage(started.id, 'NovaMed');
      expect(afterManufacturer.pendingQuestion?.field).toBe('ApproximateAge');

      const afterAge = await service.submitMessage(
        started.id,
        '7 años; creo que es Orion Imaging.',
      );

      // The age question was answered...
      expect(group(afterAge).approximateAge).toEqual(
        expect.objectContaining({
          state: 'Known',
          value: { type: 'estimate', minYears: 7, maxYears: 7 },
        }),
      );
      // ...but the manufacturer it also volunteered disagrees with the one already on record, so
      // it becomes a contradiction instead of silently replacing NovaMed.
      expect(group(afterAge).manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'Orion Imaging', certainty: 'Uncertain' }),
      );
      expect(group(afterAge).contradictions).toEqual([
        expect.objectContaining({
          field: 'Manufacturer',
          previousText: 'NovaMed',
          currentText: 'Orion Imaging',
        }),
      ]);
      expect(afterAge.pendingQuestion?.field).toBe('Manufacturer');
      expect(afterAge.pendingQuestion?.text).toContain('NovaMed');
      expect(afterAge.pendingQuestion?.text).toContain('Orion Imaging');
    } finally {
      database.close();
    }
  });
});

describe('CaptureWorkflowService cross-group follow-up scope ("para ambos" / "for both")', () => {
  /** Feeds one extraction per message, so a multi-turn conversation can be staged deterministically. */
  const sequenceExtractor = (values: readonly unknown[]): ObservationExtractionPort => {
    const parsed = values.map((value) => ObservationExtractionSchema.parse(value));
    const runtime: InferenceRuntimeInfo = {
      engine: 'Development Mock',
      execution: 'Development only',
      model: 'Sequenced test extraction',
      networkRequiredForInference: false,
      status: 'ready',
      detail: 'Test double.',
      progressPercent: 100,
    };
    let index = 0;
    return {
      kind: 'development-mock',
      initialize: async () => runtime,
      getRuntimeInfo: () => runtime,
      extract: async () => {
        const value = parsed[Math.min(index, parsed.length - 1)];
        index += 1;
        if (!value) throw new Error('The test extractor ran out of extractions.');
        return value;
      },
      dispose: async () => undefined,
    };
  };

  const equipmentItem = (
    overrides: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> => ({
    rawModality: null,
    quantity: 1,
    manufacturer: null,
    model: null,
    approximateAge: { type: 'unknown' },
    notes: null,
    certainty: 'Explicit',
    ...overrides,
  });

  const twoGroupsExtraction = (): Readonly<Record<string, unknown>> => ({
    customer: { name: 'Hospital Certainty Lab', city: 'Panama City', country: 'Panama' },
    equipment: [equipmentItem({ modality: 'MR', quantity: 2 }), equipmentItem({ modality: 'CT' })],
  });

  const threeGroupsExtraction = (): Readonly<Record<string, unknown>> => ({
    customer: { name: 'Hospital Certainty Lab', city: 'Panama City', country: 'Panama' },
    equipment: [
      equipmentItem({ modality: 'MR', quantity: 2 }),
      equipmentItem({ modality: 'CT' }),
      equipmentItem({ modality: 'Ultrasound' }),
    ],
  });

  /** An answer to the pending Manufacturer question, targeted at whichever group is missing it
   * first (MR, in every fixture above); `quantity: null` so it never re-merges over an already
   * known quantity. */
  const manufacturerAnswer = (manufacturer: string): Readonly<Record<string, unknown>> => ({
    customer: { name: null, city: null, country: null },
    equipment: [equipmentItem({ modality: 'MR', quantity: null, manufacturer })],
  });

  const groupByModality = (
    capture: CaptureSessionView,
    modality: string,
  ): CaptureEquipmentDraft => {
    const item = capture.draft.equipment.find(
      (candidate) => candidate.modality.state === 'Known' && candidate.modality.value === modality,
    );
    if (!item) throw new Error(`No equipment group with modality ${modality}.`);
    return item;
  };

  const evidenceOf = (field: DraftField<unknown>): readonly string[] =>
    field.state === 'Missing' ? [] : field.evidenceIds;

  const lastUserEvidence = (capture: CaptureSessionView): string =>
    String(capture.messages.filter((item) => item.role === 'User').at(-1)?.id);

  it('applies "NovaMed para ambos" to both equipment groups and asks no redundant follow-up', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([twoGroupsExtraction(), manufacturerAnswer('NovaMed')]),
    );
    try {
      const started = service.start();
      const afterFirst = await service.submitMessage(
        started.id,
        'Tienen dos resonadores y un tomografo.',
      );
      expect(afterFirst.pendingQuestion?.field).toBe('Manufacturer');
      expect(afterFirst.pendingQuestion?.target).toEqual({
        type: 'Equipment',
        equipmentGroupId: groupByModality(afterFirst, 'MR').id,
      });

      const answered = await service.submitMessage(started.id, 'NovaMed para ambos');
      const evidenceId = lastUserEvidence(answered);

      expect(groupByModality(answered, 'MR').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed', certainty: 'Explicit' }),
      );
      expect(groupByModality(answered, 'CT').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed', certainty: 'Explicit' }),
      );
      // The same user message backs both fields.
      expect(evidenceOf(groupByModality(answered, 'MR').manufacturer)).toContain(evidenceId);
      expect(evidenceOf(groupByModality(answered, 'CT').manufacturer)).toContain(evidenceId);
      // No redundant CT manufacturer follow-up.
      expect(answered.pendingQuestion?.field).not.toBe('Manufacturer');
    } finally {
      database.close();
    }
  });

  it('applies the English "for both" marker the same way', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([twoGroupsExtraction(), manufacturerAnswer('NovaMed')]),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'They have two MR systems and one CT.');
      const answered = await service.submitMessage(started.id, 'NovaMed for both');

      expect(groupByModality(answered, 'MR').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed' }),
      );
      expect(groupByModality(answered, 'CT').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed' }),
      );
      expect(answered.pendingQuestion?.field).not.toBe('Manufacturer');
    } finally {
      database.close();
    }
  });

  it('does not propagate a plain manufacturer answer with no scope marker', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([twoGroupsExtraction(), manufacturerAnswer('NovaMed')]),
    );
    try {
      const started = service.start();
      await service.submitMessage(started.id, 'Tienen dos resonadores y un tomografo.');
      const answered = await service.submitMessage(started.id, 'NovaMed');

      expect(groupByModality(answered, 'MR').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed' }),
      );
      expect(groupByModality(answered, 'CT').manufacturer.state).toBe('Missing');
      expect(answered.pendingQuestion?.field).toBe('Manufacturer');
      expect(answered.pendingQuestion?.target).toEqual({
        type: 'Equipment',
        equipmentGroupId: groupByModality(answered, 'CT').id,
      });
    } finally {
      database.close();
    }
  });

  it('does not guess which two groups "para ambos" means when there are three', async () => {
    const { database, service } = createHarness(
      sequenceExtractor([threeGroupsExtraction(), manufacturerAnswer('NovaMed')]),
    );
    try {
      const started = service.start();
      await service.submitMessage(
        started.id,
        'Tienen dos resonadores, un tomografo y un ultrasonido.',
      );
      const answered = await service.submitMessage(started.id, 'NovaMed para ambos');

      expect(groupByModality(answered, 'MR').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed' }),
      );
      // Ambiguous with three groups: neither of the other two is guessed at.
      expect(groupByModality(answered, 'CT').manufacturer.state).toBe('Missing');
      expect(groupByModality(answered, 'Ultrasound').manufacturer.state).toBe('Missing');
      // Normal follow-up behaviour continues instead.
      expect(answered.pendingQuestion?.field).toBe('Manufacturer');
    } finally {
      database.close();
    }
  });

  it('routes a conflicting existing value through contradiction semantics instead of overwriting it', async () => {
    const initialExtraction = (): Readonly<Record<string, unknown>> => ({
      customer: { name: 'Hospital Certainty Lab', city: 'Panama City', country: 'Panama' },
      equipment: [
        equipmentItem({ modality: 'MR', quantity: 2 }),
        equipmentItem({ modality: 'CT', manufacturer: 'Orion Imaging' }),
      ],
    });
    const { database, service } = createHarness(
      sequenceExtractor([initialExtraction(), manufacturerAnswer('NovaMed')]),
    );
    try {
      const started = service.start();
      const afterFirst = await service.submitMessage(
        started.id,
        'Tienen dos resonadores y un tomografo de Orion Imaging.',
      );
      expect(afterFirst.pendingQuestion?.field).toBe('Manufacturer');
      expect(groupByModality(afterFirst, 'CT').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'Orion Imaging', certainty: 'Explicit' }),
      );
      const ctEvidenceBefore = evidenceOf(groupByModality(afterFirst, 'CT').manufacturer);

      const answered = await service.submitMessage(started.id, 'NovaMed para ambos');

      expect(groupByModality(answered, 'MR').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed', certainty: 'Explicit' }),
      );
      // CT is NOT silently overwritten: the conflicting claim becomes an open contradiction,
      // exactly as it would for a normal single-group disagreement (P3-S6).
      expect(groupByModality(answered, 'CT').manufacturer).toEqual(
        expect.objectContaining({ state: 'Known', value: 'NovaMed', certainty: 'Uncertain' }),
      );
      expect(groupByModality(answered, 'CT').contradictions).toEqual([
        expect.objectContaining({
          field: 'Manufacturer',
          previousText: 'Orion Imaging',
          previousEvidenceIds: ctEvidenceBefore,
          currentText: 'NovaMed',
        }),
      ]);
      expect(answered.pendingQuestion?.field).toBe('Manufacturer');
      expect(answered.pendingQuestion?.text).toContain('Orion Imaging');
      expect(answered.pendingQuestion?.text).toContain('NovaMed');
    } finally {
      database.close();
    }
  });
});
