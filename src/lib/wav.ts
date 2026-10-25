export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

export function bufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  }
  return btoa(binary);
}

/** PCM wav to mono float samples. Used where AudioContext is not available. */
export function decodeWavPcm16(data: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(data);
  if (view.byteLength < 44 || readTag(view, 0) !== "RIFF" || readTag(view, 8) !== "WAVE") {
    throw new Error("not a wav file");
  }
  let offset = 12;
  let rate = 16000;
  let channels = 1;
  let bits = 16;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= view.byteLength) {
    const tag = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (tag === "fmt ") {
      channels = view.getUint16(start + 2, true);
      rate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (tag === "data") {
      dataOffset = start;
      dataBytes = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (dataOffset < 0 || bits !== 16 || !(rate > 0) || !(channels > 0)) {
    throw new Error("wav must be 16-bit PCM");
  }
  const frames = Math.floor(dataBytes / (2 * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const sample = view.getInt16(dataOffset + (i * channels + ch) * 2, true);
      sum += sample < 0 ? sample / 0x8000 : sample / 0x7fff;
    }
    samples[i] = sum / channels;
  }
  return { samples, sampleRate: rate };
}

function readTag(view: DataView, offset: number): string {
  let tag = "";
  for (let i = 0; i < 4; i++) tag += String.fromCharCode(view.getUint8(offset + i));
  return tag;
}

export async function decodeToMono(
  data: ArrayBuffer,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ctx = new AudioContext();
  const copy = data.slice(0);
  const buffer = await ctx.decodeAudioData(copy);
  const channel = buffer.getChannelData(0);
  const samples = new Float32Array(channel);
  if (ctx.state !== "closed") await ctx.close();
  return { samples, sampleRate: buffer.sampleRate };
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
