const cache = new Map<string, AudioBuffer>();
let audioCtx: AudioContext | null = null;

function getContext() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

async function loadBuffer(url: string): Promise<AudioBuffer> {
  const cached = cache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  const buf = await getContext().decodeAudioData(await res.arrayBuffer());
  cache.set(url, buf);
  return buf;
}

const SOUNDS_KEY = "claudio-sounds-enabled";

export function isSoundsEnabled(): boolean {
  return localStorage.getItem(SOUNDS_KEY) !== "false";
}

export function setSoundsEnabled(enabled: boolean) {
  localStorage.setItem(SOUNDS_KEY, String(enabled));
}

export async function playSound(url: string, volume: number, lpFreq = 1000) {
  if (!isSoundsEnabled()) return;
  try {
    const ctx = getContext();
    if (ctx.state === "suspended") await ctx.resume();
    const buffer = await loadBuffer(url);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = lpFreq;
    source.connect(lpf).connect(gain).connect(ctx.destination);
    // source.connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // Silently ignore audio errors
  }
}

export const sounds = {
  navigate: () => playSound("/tap_01.wav", 0.8, 300),
  select: () => playSound("/toggle_on.wav", 0.7, 700),
  back: () => playSound("/toggle_off.wav", 0.4, 700),
};
