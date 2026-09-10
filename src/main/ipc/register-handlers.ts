import { ipcMain } from 'electron';
import { ZodError, type ZodType } from 'zod';
import type { CompositionRoot } from '../composition-root';
import {
  CaptureIdRequestSchema,
  CorrectionRequestSchema,
  CustomerRequestSchema,
  DuplicateResolutionRequestSchema,
  EmptyRequestSchema,
  IPC_CHANNELS,
  StartCaptureRequestSchema,
  SubmitCaptureRequestSchema,
  type IpcResult,
} from '@/shared';

const register = <TInput, TOutput>(
  channel: string,
  schema: ZodType<TInput>,
  handler: (input: TInput) => TOutput | Promise<TOutput>,
): void => {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<IpcResult<TOutput>> => {
    try {
      const input = schema.parse(raw);
      return { ok: true, data: await handler(input) };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof ZodError ? 'VALIDATION_ERROR' : 'APPLICATION_ERROR',
          message: error instanceof Error ? error.message : 'Unexpected application error.',
        },
      };
    }
  });
};

export const registerIpcHandlers = (services: CompositionRoot): void => {
  register(IPC_CHANNELS.inferenceStatus, EmptyRequestSchema, () =>
    services.extraction.getRuntimeInfo(),
  );
  register(IPC_CHANNELS.inferenceInitialize, EmptyRequestSchema, () =>
    services.extraction.initialize(),
  );
  register(IPC_CHANNELS.captureStart, StartCaptureRequestSchema, ({ source }) =>
    services.capture.start({ source }),
  );
  register(IPC_CHANNELS.captureSubmit, SubmitCaptureRequestSchema, ({ captureId, text }) =>
    services.capture.submitMessage(captureId, text),
  );
  register(IPC_CHANNELS.captureCorrect, CorrectionRequestSchema, ({ captureId, correction }) =>
    services.capture.correct(captureId, correction),
  );
  register(IPC_CHANNELS.captureReview, CaptureIdRequestSchema, ({ captureId }) =>
    services.capture.proceedToReview(captureId),
  );
  register(IPC_CHANNELS.captureConfirm, CaptureIdRequestSchema, ({ captureId }) =>
    services.capture.confirmReview(captureId),
  );
  register(IPC_CHANNELS.captureSave, CaptureIdRequestSchema, ({ captureId }) =>
    services.capture.save(captureId),
  );
  register(IPC_CHANNELS.customersList, EmptyRequestSchema, () => services.queries.listCustomers());
  register(IPC_CHANNELS.customer360, CustomerRequestSchema, ({ customerId }) =>
    services.queries.getCustomer360(customerId),
  );
  register(
    IPC_CHANNELS.duplicateResolve,
    DuplicateResolutionRequestSchema,
    ({ candidateId, resolution }) =>
      services.queries.resolveDuplicateCandidate(candidateId, resolution),
  );
  register(IPC_CHANNELS.dashboard, EmptyRequestSchema, () => services.queries.getDashboard());
};
