export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(): string;
}

export interface SpeechToTextPort {
  transcribe(localAudioUri: string): Promise<{ text: string; engine: 'QVAC' }>;
}
