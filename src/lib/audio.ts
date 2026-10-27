import { concatFloat32, encodeWav } from "./wav";

export type Recorder = {
  stop: () => Promise<{ wav: Blob; samples: Float32Array; sampleRate: number }>;
};

export async function startRecorder(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.state === "suspended") await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(gain);
  gain.connect(ctx.destination);

  return {
    async stop() {
      processor.disconnect();
      source.disconnect();
      gain.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      const samples = concatFloat32(chunks);
      const sampleRate = ctx.sampleRate;
      if (ctx.state !== "closed") await ctx.close();
      return { wav: encodeWav(samples, sampleRate), samples, sampleRate };
    },
  };
}

let playbackCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

export const SLICE_PAD_SEC = 0.03;

export type SliceSource = ArrayBuffer | { samples: Float32Array; sampleRate: number };

function playbackContext(): AudioContext {
  if (!playbackCtx || playbackCtx.state === "closed") {
    playbackCtx = new AudioContext();
  }
  return playbackCtx;
}

function stopCurrent() {
  if (!currentSource) return;
  try {
    currentSource.stop();
  } catch {
    /* already stopped */
  }
  currentSource = null;
}

async function decodeSource(ctx: AudioContext, source: SliceSource): Promise<AudioBuffer> {
  if (source instanceof ArrayBuffer) {
    return ctx.decodeAudioData(source.slice(0));
  }
  const buffer = ctx.createBuffer(1, source.samples.length, source.sampleRate);
  buffer.copyToChannel(new Float32Array(source.samples), 0);
  return buffer;
}

export async function playBuffer(
  data: ArrayBuffer,
  opts?: {
    onTime?: (t: number, duration: number) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const ctx = playbackContext();
  if (ctx.state === "suspended") await ctx.resume();

  stopCurrent();

  const decoded = await ctx.decodeAudioData(data.slice(0));
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);
  currentSource = source;
  const duration = decoded.duration;
  let raf = 0;
  const started = ctx.currentTime;
  const tick = () => {
    if (ctx.state === "closed") return;
    opts?.onTime?.(Math.min(duration, ctx.currentTime - started), duration);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const stop = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      if (currentSource === source) currentSource = null;
      resolve();
    };
    source.onended = stop;
    opts?.signal?.addEventListener("abort", stop, { once: true });
    try {
      source.start();
    } catch (err) {
      stop();
      reject(err);
    }
  });
}

/** Play [startSec, endSec] of audio already decoded for the graph, with a short pad. */
export async function playSlice(
  data: SliceSource,
  startSec: number,
  endSec: number,
  opts?: {
    padSec?: number;
    onTime?: (t: number) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  if (!(endSec > startSec)) return;
  const ctx = playbackContext();
  if (ctx.state === "suspended") await ctx.resume();
  stopCurrent();

  const decoded = await decodeSource(ctx, data);
  const pad = opts?.padSec ?? SLICE_PAD_SEC;
  const offset = Math.max(0, startSec - pad);
  const stopAt = Math.min(decoded.duration, endSec + pad);
  const dur = stopAt - offset;
  if (!(dur > 0)) return;

  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);
  currentSource = source;
  let raf = 0;
  const started = ctx.currentTime;
  const tick = () => {
    if (ctx.state === "closed") return;
    const elapsed = ctx.currentTime - started;
    opts?.onTime?.(Math.min(stopAt, offset + elapsed));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const stop = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      if (currentSource === source) currentSource = null;
      resolve();
    };
    source.onended = stop;
    opts?.signal?.addEventListener("abort", stop, { once: true });
    try {
      source.start(ctx.currentTime, offset, dur);
    } catch (err) {
      stop();
      reject(err);
    }
  });
}
