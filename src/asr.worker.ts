// On-device speech-to-text, off the main thread. Transformers.js caches the model and runtime in
// Cache Storage, so after the first download this works with no network at all.
import { env, pipeline } from '@huggingface/transformers';

// Moonshine base: Whisper-class accuracy for English, ~63 MB, and much faster on phones because it only
// processes the audio you recorded (Whisper always crunches a 30 s window).
// Lighter: 'onnx-community/moonshine-tiny-ONNX' (~28 MB). Whisper instead: 'onnx-community/whisper-base.en' (~77 MB).
const MODEL = 'onnx-community/moonshine-base-ONNX';

// CPU only, so load the plain ONNX runtime (~14 MB) instead of the ~27 MB WebGPU-capable default.
const version = env.backends.onnx.versions?.web;
if (version) {
  const ort = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort-wasm-simd-threaded`;
  env.backends.onnx.wasm!.wasmPaths = { mjs: `${ort}.mjs`, wasm: `${ort}.wasm` };
}

const post = (msg: object) => (self as unknown as Worker).postMessage(msg);
const load = () => pipeline('automatic-speech-recognition', MODEL, {
  device: 'wasm',
  dtype: 'q8',
  progress_callback: p => { if (p.status === 'progress_total') post({ progress: Math.round(p.progress) }); },
});
let model: ReturnType<typeof load> | undefined;

// { id } alone just loads (downloading the first time); { id, audio } also transcribes 16 kHz mono PCM.
onmessage = async ({ data: { id, audio } }: MessageEvent<{ id: number; audio?: Float32Array }>) => {
  try {
    model ??= load();
    const asr = await model;
    const out = audio ? await asr(audio) : { text: '' };
    post({ id, text: out.text.trim() });
  } catch (e) {
    model = undefined; // let the next tap retry, e.g. after a failed download
    post({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
