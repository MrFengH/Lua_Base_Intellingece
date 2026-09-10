import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpeechToTextPort } from '@/application/ports';
import { transcribeVoiceAudio } from '@/main/voice-transcription';

/** A fake port that records the path it was asked to transcribe, so the test can assert the
 * file existed (and held the right bytes) at the moment `transcribe` was called. */
class RecordingPort implements SpeechToTextPort {
  readonly kind = 'development-mock' as const;
  calledWithPath: string | null = null;
  calledWithBytes: Uint8Array | null = null;

  async initialize() {
    return this.getRuntimeInfo();
  }
  getRuntimeInfo() {
    return {
      engine: 'Development Mock' as const,
      execution: 'Development only' as const,
      model: 'recording-port',
      networkRequiredForInference: false,
      status: 'ready' as const,
      detail: null,
      progressPercent: null,
    };
  }
  async transcribe(localAudioPath: string) {
    this.calledWithPath = localAudioPath;
    this.calledWithBytes = new Uint8Array(await readFile(localAudioPath));
    return { text: 'transcribed text' };
  }
  async dispose() {}
}

class FailingPort implements SpeechToTextPort {
  readonly kind = 'development-mock' as const;
  async initialize() {
    return this.getRuntimeInfo();
  }
  getRuntimeInfo() {
    return {
      engine: 'Development Mock' as const,
      execution: 'Development only' as const,
      model: 'failing-port',
      networkRequiredForInference: false,
      status: 'error' as const,
      detail: null,
      progressPercent: null,
    };
  }
  async transcribe(): Promise<{ text: string }> {
    throw new Error('transcription engine unavailable');
  }
  async dispose() {}
}

describe('transcribeVoiceAudio (main-process temp file orchestration)', () => {
  it('writes the audio bytes to a temp file, passes its path to the port, and returns the transcript', async () => {
    const port = new RecordingPort();
    const audio = new Uint8Array([82, 73, 70, 70]); // 'RIFF'
    const result = await transcribeVoiceAudio(port, audio);

    expect(result).toEqual({ text: 'transcribed text' });
    expect(port.calledWithPath).toBeTruthy();
    expect(port.calledWithPath?.endsWith('.wav')).toBe(true);
    expect(port.calledWithPath?.startsWith(tmpdir())).toBe(true);
    expect(port.calledWithBytes).toEqual(audio);
  });

  it('deletes the temporary file and its directory after a successful transcription', async () => {
    const port = new RecordingPort();
    await transcribeVoiceAudio(port, new Uint8Array([1, 2, 3]));

    const path = port.calledWithPath as string;
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it('still deletes the temp file when the port throws, and propagates the error', async () => {
    const port = new FailingPort();
    const before = await readdir(tmpdir());

    await expect(transcribeVoiceAudio(port, new Uint8Array([1]))).rejects.toThrow(
      'transcription engine unavailable',
    );

    const after = await readdir(tmpdir());
    const leaked = after.filter(
      (entry) => entry.startsWith('cib-voice-') && !before.includes(entry),
    );
    expect(leaked).toEqual([]);
  });

  it('never persists raw audio outside its own single-use temp directory', async () => {
    const port = new RecordingPort();
    await transcribeVoiceAudio(port, new Uint8Array([9, 9, 9]));
    const path = port.calledWithPath as string;
    expect(path).toContain('cib-voice-');
  });
});
