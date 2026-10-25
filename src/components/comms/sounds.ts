"use client";
/** Local dialer sounds via Web Audio: DTMF key tones and a North American ringback (440+480 Hz, 2s on / 4s off). */

let ctx: AudioContext | null = null;
function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

function dualTone(freqs: [number, number], start: number, length: number, volume: number) {
  const a = audio();
  if (!a) return [];
  const gain = a.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.setValueAtTime(volume, start + length - 0.02);
  gain.gain.linearRampToValueAtTime(0, start + length);
  gain.connect(a.destination);
  return freqs.map((f) => {
    const o = a.createOscillator();
    o.frequency.value = f;
    o.connect(gain);
    o.start(start);
    o.stop(start + length);
    return o;
  });
}

export function playDtmf(key: string) {
  const a = audio();
  const f = DTMF[key];
  if (!a || !f) return;
  dualTone(f, a.currentTime, 0.15, 0.12);
}

let ringTimer: ReturnType<typeof setInterval> | null = null;
let ringOsc: OscillatorNode[] = [];

export function startRingback() {
  const a = audio();
  if (!a || ringTimer) return;
  const ring = () => { ringOsc = dualTone([440, 480], a.currentTime, 2, 0.08); };
  ring();
  ringTimer = setInterval(ring, 6000);
}

export function stopRingback() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  for (const o of ringOsc) { try { o.stop(); } catch {} }
  ringOsc = [];
}
