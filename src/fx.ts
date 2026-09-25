// Imperative fun: sound, particles, toasts. The motion bits sit out under prefers-reduced-motion.
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let audio: AudioContext | undefined;

// Synthesised "cha-ching", so no audio file ships. Call it inside the tap handler, before any await (iOS unlocks audio only there).
export function clink() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const t = audio.currentTime;
    for (const [freq, at] of [[1976, 0], [2637, 0.08]]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.3, t + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.45);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.5);
    }
  } catch {
    // No audio? The coins still fly.
  }
}

function spawn(className: string, text: string, style: string) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  el.style.cssText = style;
  el.onanimationend = () => el.remove();
  document.body.append(el);
}

export function coinBurst(from: Element) {
  if (reducedMotion()) return;
  const r = from.getBoundingClientRect();
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12;
    const dist = 70 + Math.random() * 70;
    spawn('coin', '🪙', `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 50}px;--r:${Math.random() * 720 - 360}deg`);
  }
}

const COLORS = ['#B8F135', '#FFD23F', '#9B5DE5', '#FF5A36', '#3A86FF', '#FF4FA3'];

export function confetti() {
  if (reducedMotion()) return;
  for (let i = 0; i < 70; i++) {
    spawn('confetti', '', `left:${Math.random() * 100}vw;background:${COLORS[i % COLORS.length]};--dx:${Math.random() * 160 - 80}px;--r:${Math.random() * 1080}deg;--t:${2 + Math.random() * 2}s;animation-delay:${Math.random() * 0.6}s`);
  }
}

// #toasts is an aria-live region in index.html, so screen readers hear these too.
export function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toasts')?.append(el);
  setTimeout(() => el.remove(), 3000);
}
