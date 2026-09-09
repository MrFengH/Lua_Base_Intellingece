import type { CaptureDraft, Customer, FollowUpQuestion } from '@/domain';
import type { InferenceRuntimeInfo, ObservationExtraction } from '../contracts';

export interface ExtractionContext {
  captureDraft: CaptureDraft | null;
  pendingQuestion: FollowUpQuestion | null;
  conversation: readonly { role: 'user' | 'assistant'; content: string }[];
  knownCustomers: readonly Pick<Customer, 'id' | 'name' | 'city' | 'country'>[];
}

export interface ObservationExtractionPort {
  readonly kind: 'qvac' | 'development-mock';
  initialize(): Promise<InferenceRuntimeInfo>;
  getRuntimeInfo(): InferenceRuntimeInfo;
  extract(text: string, context: ExtractionContext): Promise<ObservationExtraction>;
  dispose(): Promise<void>;
}
