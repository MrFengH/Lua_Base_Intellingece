import { describe, expect, it } from 'vitest';
import {
  captureSubmissionError,
  createOptimisticMessage,
  reconcileOptimisticMessages,
} from '@/renderer/src/capture-message-state';

describe('capture optimistic message reconciliation', () => {
  it('creates a renderer-only identity without changing the submitted text', () => {
    expect(createOptimisticMessage('capture-1', 'hola', 3, '2026-09-10T12:00:00.000Z')).toEqual({
      id: 'optimistic:capture-1:3',
      captureId: 'capture-1',
      role: 'User',
      content: 'hola',
      createdAt: '2026-09-10T12:00:00.000Z',
    });
  });

  it('removes temporary entries by capture id rather than globally deduplicating text', () => {
    const first = createOptimisticMessage('capture-1', 'hola', 1, '2026-09-10T12:00:00.000Z');
    const sameTextInAnotherCapture = createOptimisticMessage(
      'capture-2',
      'hola',
      2,
      '2026-09-10T12:01:00.000Z',
    );

    expect(reconcileOptimisticMessages([first, sameTextInAnotherCapture], 'capture-1')).toEqual([
      sameTextInAnotherCapture,
    ]);
  });

  it('turns an inference failure into an understandable recovery message', () => {
    expect(captureSubmissionError(new Error('Model worker stopped.')).message).toBe(
      'No se pudo procesar el mensaje. Model worker stopped.',
    );
  });
});
