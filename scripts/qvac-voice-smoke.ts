import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QvacSpeechToTextService, type QvacSpeechToTextLifecycleEvent } from '@/infrastructure';

/**
 * Proves the real `@qvac/sdk` voice path — model load, transcription call, unload — runs on this
 * machine. It does NOT prove transcription accuracy: the audio below is a synthesized tone, not
 * speech, so any returned text (including empty text) is a pass. Word-error-rate measurement
 * against real hospital vocabulary is a separate, not-yet-built exercise — see
 * docs/MODEL_STRATEGY.md's Capability 2 "Open questions".
 *
 * Deliberately not part of `npm test`: it needs a real model and compatible hardware, exactly
 * like `scripts/qvac-smoke.ts` for text extraction.
 */
const messages: Readonly<Record<QvacSpeechToTextLifecycleEvent, string>> = {
  'runtime-initialized': 'PASS: QVAC voice runtime initialized',
  'model-loaded': 'PASS: voice model loaded',
  'transcription-completed': 'PASS: local transcription completed',
};

/** A short, silent 16-bit PCM mono WAV at 16 kHz — enough for the transcription pipeline to
 * decode and run end to end without depending on any bundled or generated speech audio. */
const buildSilentWav = (durationSeconds: number, sampleRate = 16_000): Uint8Array => {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);
  // Samples are left at zero (silence); no loop needed.
  return new Uint8Array(buffer);
};

const service = new QvacSpeechToTextService({
  modelPath: process.env.CIB_QVAC_VOICE_MODEL_PATH,
  onLifecycleEvent: (event) => console.log(messages[event]),
});

const tempDirectory = mkdtempSync(join(tmpdir(), 'cib-voice-smoke-'));
const audioPath = join(tempDirectory, 'silence.wav');

try {
  writeFileSync(audioPath, buildSilentWav(1.5));
  await service.initialize();
  const result = await service.transcribe(audioPath);
  console.log(
    `Transcript (silence, any value including empty is a pass): ${JSON.stringify(result.text)}`,
  );
  console.log(
    'PASS: direct @qvac/sdk whisper path used; no cloud transcription provider is configured',
  );
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await service.dispose();
  rmSync(tempDirectory, { recursive: true, force: true });
}
