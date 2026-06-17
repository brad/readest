export function encodeWav(
  pcmData: Uint8Array,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + pcmData.length, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw PCM = 1)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, (numChannels * bitsPerSample) / 8, true);
  // bits per sample
  view.setUint16(34, bitsPerSample, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, pcmData.length, true);

  const result = new Uint8Array(44 + pcmData.length);
  result.set(new Uint8Array(header), 0);
  result.set(pcmData, 44);

  return result;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
