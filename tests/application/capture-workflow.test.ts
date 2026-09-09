import { describe, expect, it } from 'vitest';
import type { Clock, IdGenerator } from '@/application';
import { CaptureWorkflowService } from '@/application';
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

const createHarness = () => {
  const database = new LocalSqliteDatabase(':memory:');
  const repository = new SqliteInstalledBaseRepository(database);
  applyDevelopmentSeed(repository);
  const extractor = new DevelopmentMockObservationExtractionService();
  const service = new CaptureWorkflowService(
    extractor,
    repository,
    new FixedClock(),
    new SequenceIds(),
  );
  return { database, repository, service };
};

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
