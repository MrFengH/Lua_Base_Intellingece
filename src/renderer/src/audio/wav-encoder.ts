/**
 * Encodes a decoded `AudioBuffer` as a 16-bit PCM mono WAV file. QVAC's transcription decoder
 * accepts `.wav` directly (see `SUPPORTED_AUDIO_FORMATS` in `@qvac/inference`); the browser's own
 * `MediaRecorder` output (webm/opus) is not in that list, so recorded audio is decoded back to
 * raw PCM via `AudioContext.decodeAudioData` first and re-encoded here rather than sent as-is.
 */
export const encodeWavFromAudioBuffer = (buffer: AudioBuffer): Uint8Array => {
  const { sampleRate, length, numberOfChannels } = buffer;
  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    channelData.push(buffer.getChannelData(channel));
  }

  // Downmix to mono: whisper models expect single-channel audio, and this application never
  // needs stereo separation for a dictated observation.
  const mono = new Float32Array(length);
  for (let sample = 0; sample < length; sample += 1) {
    let sum = 0;
    for (let channel = 0; channel < channelData.length; channel += 1) {
      sum += channelData[channel]?.[sample] ?? 0;
    }
    mono[sample] = sum / Math.max(1, channelData.length);
  }

  const bytesPerSample = 2;
  const dataSize = length * bytesPerSample;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let sample = 0; sample < length; sample += 1) {
    const clamped = Math.max(-1, Math.min(1, mono[sample] ?? 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(out);
};
