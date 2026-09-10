import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpeechToTextPort } from '@/application/ports';

/**
 * `SpeechToTextPort.transcribe` takes a path to audio already on disk; this is the one place that
 * writes the bytes the renderer sent over IPC to a temporary file, transcribes it, and always
 * removes the file and its directory afterward — recorded audio is never retained (see
 * docs/PRIVACY_OFFLINE.md). A per-call temp directory (rather than a shared one) means concurrent
 * calls can never collide or race on cleanup.
 */
export const transcribeVoiceAudio = async (
  port: SpeechToTextPort,
  audio: Uint8Array,
): Promise<{ text: string }> => {
  const directory = await mkdtemp(join(tmpdir(), 'cib-voice-'));
  const audioPath = join(directory, `${randomBytes(8).toString('hex')}.wav`);
  try {
    await writeFile(audioPath, audio);
    return await port.transcribe(audioPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
