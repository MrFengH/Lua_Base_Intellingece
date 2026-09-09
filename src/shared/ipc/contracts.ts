import { z } from 'zod';
import type {
  CaptureCorrection,
  CaptureSessionView,
  Customer360View,
  CustomerListItem,
  DashboardView,
  InferenceRuntimeInfo,
} from '@/application/contracts';

export const IPC_CHANNELS = {
  inferenceStatus: 'inference:get-status',
  inferenceInitialize: 'inference:initialize',
  captureStart: 'capture:start',
  captureSubmit: 'capture:submit-message',
  captureCorrect: 'capture:correct',
  captureReview: 'capture:proceed-to-review',
  captureSave: 'capture:save',
  customersList: 'customers:list',
  customer360: 'customers:get-360',
  dashboard: 'dashboard:get',
} as const;

export const EmptyRequestSchema = z.undefined();
export const StartCaptureRequestSchema = z
  .object({ source: z.enum(['Text', 'Voice', 'Photo']).default('Text') })
  .strict();
export const CaptureIdRequestSchema = z.object({ captureId: z.string().min(1) }).strict();
export const SubmitCaptureRequestSchema = z
  .object({ captureId: z.string().min(1), text: z.string().trim().min(1) })
  .strict();
export const CorrectionRequestSchema = z
  .object({
    captureId: z.string().min(1),
    correction: z
      .object({
        customer: z
          .object({
            name: z.string().nullable().optional(),
            city: z.string().nullable().optional(),
            country: z.string().nullable().optional(),
          })
          .strict()
          .optional(),
        equipment: z
          .array(
            z
              .object({
                id: z.string().min(1),
                modality: z.string().nullable().optional(),
                quantity: z.number().int().positive().nullable().optional(),
                manufacturer: z.string().nullable().optional(),
                model: z.string().nullable().optional(),
                approximateAgeYears: z.number().nonnegative().nullable().optional(),
                notes: z.string().nullable().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
  })
  .strict();
export const CustomerRequestSchema = z.object({ customerId: z.string().min(1) }).strict();

export interface IpcFailure {
  ok: false;
  error: { code: 'VALIDATION_ERROR' | 'APPLICATION_ERROR'; message: string };
}

export type IpcResult<T> = { ok: true; data: T } | IpcFailure;

export interface InstalledBaseApi {
  getInferenceStatus(): Promise<IpcResult<InferenceRuntimeInfo>>;
  initializeInference(): Promise<IpcResult<InferenceRuntimeInfo>>;
  startCapture(source?: 'Text' | 'Voice' | 'Photo'): Promise<IpcResult<CaptureSessionView>>;
  submitCaptureMessage(captureId: string, text: string): Promise<IpcResult<CaptureSessionView>>;
  correctCapture(
    captureId: string,
    correction: CaptureCorrection,
  ): Promise<IpcResult<CaptureSessionView>>;
  proceedToReview(captureId: string): Promise<IpcResult<CaptureSessionView>>;
  saveCapture(
    captureId: string,
  ): Promise<IpcResult<{ capture: CaptureSessionView; customerId: string }>>;
  listCustomers(): Promise<IpcResult<readonly CustomerListItem[]>>;
  getCustomer360(customerId: string): Promise<IpcResult<Customer360View | null>>;
  getDashboard(): Promise<IpcResult<DashboardView>>;
}
