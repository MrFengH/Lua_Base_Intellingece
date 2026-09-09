import { z } from 'zod';

export const INFERENCE_STATUSES = [
  'model-not-loaded',
  'downloading',
  'loading',
  'ready',
  'processing',
  'error',
] as const;

export const InferenceRuntimeInfoSchema = z
  .object({
    engine: z.enum(['QVAC', 'Development Mock']),
    execution: z.enum(['On-device', 'Development only']),
    model: z.string().min(1),
    networkRequiredForInference: z.boolean(),
    status: z.enum(INFERENCE_STATUSES),
    detail: z.string().nullable(),
    progressPercent: z.number().min(0).max(100).nullable(),
  })
  .strict();

export type InferenceRuntimeInfo = z.infer<typeof InferenceRuntimeInfoSchema>;
