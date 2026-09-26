// Voice notes: record with MediaRecorder, then transcribe with Groq's Whisper (when you have a Groq key and
// signal) or on this device with a small speech model running offline in a worker.
import { whisper } from './ai';
import type { Settings } from './db';

export const OFFLINE_MB = 80; // model ~63 MB + speech runtime ~14 MB, downloaded once
const READY = 'kp-voice-model';

export const cloudVoice = (s: Settings) => s.provider === 'groq' && !!s.apiKey && navigator.onLine;

export const offlineReady = () => {
  try {
    return localStorage.getItem(READY) === '1';
  } catch {
    return false;
  }
};

let worker: Worker | undefined;
let nextId = 0;
let onProgress: ((pct: number) => void) | undefined;
const waiting = new Map<number, (r: { text?: string; error?: string }) => void>();

function onDevice(audio?: Float32Array, progress?: (pct: number) => void) {
  onProgress = progress;
  if (!worker) {
    worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if ('progress' in data) return onProgress?.(data.progress);
      waiting.get(data.id)?.(data);
      waiting.delete(data.id);
    };
  }
  const id = nextId++;
  return new Promise<string>((ok, fail) => {
    waiting.set(id, r => {
      if (r.error) return fail(new Error(r.error));
      try {
        localStorage.setItem(READY, '1');
      } catch {
        // just means we'll ask before downloading again
      }
      ok(r.text ?? '');
    });
    worker!.postMessage({ id, audio });
  });
}

// Downloads (first time only) and warms up the offline model. Called when recording starts,
// so the model loads while you talk.
export const loadOffline = (progress?: (pct: number) => void) => onDevice(undefined, progress);

export async function removeOffline() {
  worker?.terminate();
  worker = undefined;
  for (const key of await caches.keys()) if (key.startsWith('transformers')) await caches.delete(key);
  try {
    localStorage.removeItem(READY);
  } catch {
    // nothing to forget
  }
}

// Starts the mic; the returned function stops it and hands back the recording.
export async function record() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.start();
  return () => new Promise<Blob>(done => {
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      done(new Blob(chunks, { type: rec.mimeType }));
    };
    rec.stop();
  });
}

export async function transcribe(audio: Blob, s: Settings, progress?: (pct: number) => void) {
  // 16 kHz mono PCM is what the on-device model eats; it also lets us skip silent taps
  // (Whisper-style models invent words for silence).
  const ctx = new AudioContext({ sampleRate: 16000 });
  const pcm = await ctx.decodeAudioData(await audio.arrayBuffer()).then(b => b.getChannelData(0)).finally(() => ctx.close());
  const loud = Math.sqrt(pcm.reduce((sum, v) => sum + v * v, 0) / (pcm.length || 1));
  if (pcm.length < 16000 * 0.4 || loud < 0.003) throw new Error("didn't catch that, try again");
  if (cloudVoice(s)) {
    try {
      return await whisper(s, audio);
    } catch (e) {
      if (!offlineReady()) throw e; // don't start an 80 MB download nobody agreed to
    }
  }
  return onDevice(pcm, progress);
}
