import type { ConversationMessage } from '@/application/contracts';

export interface OptimisticConversationMessage extends ConversationMessage {
  captureId: string;
}

export const createOptimisticMessage = (
  captureId: string,
  text: string,
  sequence: number,
  createdAt: string,
): OptimisticConversationMessage => ({
  id: `optimistic:${captureId}:${sequence}`,
  captureId,
  role: 'User',
  content: text,
  createdAt,
});

/** An authoritative workflow response covers every message the backend accepted for its capture.
 * Drop temporary entries by capture identity, never by content: separate legitimate turns may
 * contain exactly the same words. */
export const reconcileOptimisticMessages = (
  messages: readonly OptimisticConversationMessage[],
  authoritativeCaptureId: string,
): readonly OptimisticConversationMessage[] =>
  messages.filter((message) => message.captureId !== authoritativeCaptureId);

export const captureSubmissionError = (cause: unknown): Error => {
  const detail = cause instanceof Error ? cause.message : 'Error inesperado.';
  return new Error(`No se pudo procesar el mensaje. ${detail}`);
};
