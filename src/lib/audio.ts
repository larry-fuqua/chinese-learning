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

function playbackContext(): AudioContext {
  if (!playbackCtx || playbackCtx.state === "closed") {
    playbackCtx = new AudioContext();
  }
  return playbackCtx;
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

  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      /* already stopped */
    }
    currentSource = null;
  }

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
