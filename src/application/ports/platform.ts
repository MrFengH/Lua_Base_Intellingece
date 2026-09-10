export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(): string;
}

import type { InferenceRuntimeInfo } from '../contracts';

/**
 * Local speech-to-text, mirroring `ObservationExtractionPort`'s lifecycle so voice gets the same
 * explicit-init / load-once / honest-failure guarantees as text extraction (see
 * docs/QVAC_ARCHITECTURE.md). `transcribe` takes a path to audio already on local disk — writing
 * microphone bytes to that path is the caller's concern, not this port's.
 */
export interface SpeechToTextPort {
  readonly kind: 'qvac' | 'development-mock';
  initialize(): Promise<InferenceRuntimeInfo>;
  getRuntimeInfo(): InferenceRuntimeInfo;
  transcribe(localAudioPath: string): Promise<{ text: string }>;
  dispose(): Promise<void>;
}
