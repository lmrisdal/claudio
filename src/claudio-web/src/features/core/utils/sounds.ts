const cache = new Map<string, AudioBuffer>();
let audioContext: AudioContext | null = null;

function getContext() {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
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
    const context = getContext();
    if (context.state === "suspended") await context.resume();
    const buffer = await loadBuffer(url);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = volume;
    const lpf = context.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = lpFreq;
    source.connect(lpf).connect(gain).connect(context.destination);
    // source.connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // Silently ignore audio errors
  }
}

export const sounds = {
  navigate: () => playSound("/tap_01.wav", 0.8, 300),
  select: () => playSound("/toggle_on.wav", 0.7, 700),
  back: () => playSound("/toggle_off.wav", 0.7, 700),
  download: () => playSound("/toggle_on.wav", 0.7, 700),
};
