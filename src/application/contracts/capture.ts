import type { CaptureDraft, FollowUpQuestion, ObservationSource } from '@/domain';

export interface ConversationMessage {
  id: string;
  role: 'User' | 'Assistant';
  content: string;
  createdAt: string;
}

export interface CaptureSessionView {
  id: string;
  observerId: string;
  observerName: string;
  visitId: string;
  observedAt: string;
  source: ObservationSource;
  draft: CaptureDraft;
  messages: readonly ConversationMessage[];
  pendingQuestion: FollowUpQuestion | null;
  /** True only after the observer explicitly accepted the agent's summary. */
  reviewConfirmed: boolean;
}

export interface CaptureCorrection {
  customer?: {
    name?: string | null;
    city?: string | null;
    country?: string | null;
  };
  equipment?: ReadonlyArray<{
    id: string;
    modality?: string | null;
    quantity?: number | null;
    manufacturer?: string | null;
    model?: string | null;
    approximateAgeYears?: number | null;
    notes?: string | null;
  }>;
}
