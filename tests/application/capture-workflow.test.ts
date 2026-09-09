import { describe, expect, it } from 'vitest';
import type {
  Clock,
  IdGenerator,
  InferenceRuntimeInfo,
  ObservationExtractionPort,
} from '@/application';
import { CaptureWorkflowService, ObservationExtractionSchema } from '@/application';
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
      expect(missingCustomer.pendingQuestion?.text).toBe('What hospital or clinic did you visit?');

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
