// Deterministic, sample-free soundtrack. Every effect time comes from timeline.js.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

new Function(readFileSync(new URL('./timeline.js', import.meta.url), 'utf8'))();
const TL = globalThis.TL;
const SR = 44100;
const N = Math.ceil(TL.DUR * SR);
const left = new Float32Array(N);
const right = new Float32Array(N);
const beat = 0.6;

const add = (at, length, voice, gain = 1, pan = 0) => {
  const from = Math.max(0, Math.floor(at * SR));
  const to = Math.min(N, Math.floor((at + length) * SR));
  const gl = gain * Math.sqrt((1 - pan) / 2);
  const gr = gain * Math.sqrt((1 + pan) / 2);
  for (let index = from; index < to; index += 1) {
    const value = voice((index - at * SR) / SR);
    left[index] += value * gl;
    right[index] += value * gr;
  }
};
const tone = (at, frequency, length = 0.18, gain = 0.12, pan = 0) =>
  add(at, length, time => Math.sin(2 * Math.PI * frequency * time) * Math.exp(-time * 18), gain, pan);
const thump = at => add(at, 0.32, time => {
  const frequency = 70 - 35 * time;
  return Math.sin(2 * Math.PI * frequency * time) * Math.exp(-time * 12);
}, 0.45);
const click = at => add(at, 0.07, time => {
  const noise = Math.sin(2 * Math.PI * 2800 * time) + Math.sin(2 * Math.PI * 4100 * time);
  return noise * Math.exp(-time * 70);
}, 0.08);
const sweep = at => add(at, 0.34, time =>
  Math.sin(2 * Math.PI * (180 + time * 920) * time) * Math.sin(Math.PI * time / 0.34), 0.12);

// A quiet pulse keeps the optional soundtrack subordinate to captions.
for (let at = 0; at < TL.DUR; at += beat) {
  tone(at, at < TL.starts.TITLE ? 110 : 146, 0.12, at < TL.starts.TITLE ? 0.025 : 0.04, at % (beat * 2) ? 0.18 : -0.18);
}

const effects = {
  type: click,
  hold: at => tone(at, 330, 0.12, 0.05),
  chapter: sweep,
  mark: at => tone(at, 720, 0.16, 0.12),
  contact: at => { click(at); tone(at, 820, 0.2, 0.13); },
  file: at => { click(at); tone(at, 620, 0.18, 0.1); },
  request: at => { thump(at); tone(at, 520, 0.24, 0.12); },
  read: at => tone(at, 680, 0.14, 0.1),
  boundary: at => { thump(at); tone(at, 240, 0.3, 0.14); },
  install: at => { thump(at); tone(at, 760, 0.35, 0.14); },
  stamp: at => { thump(at); click(at); },
  sift: at => add(at, 2.2, time => (Math.sin(time * 9000 + Math.sin(time * 3100) * 40) * Math.exp(-time * 1.6)) * 0.5, 0.05),
  outro: at => sweep(at),
};
for (const [at, kind] of TL.cues) effects[kind]?.(at);
for (const [a, b, value] of TL.typing ?? []) {
  for (let i = 0; i < value.length; i += 1) click(a + (b - a) * (i + 1) / value.length);
}

let peak = 0;
for (let index = 0; index < N; index += 1) peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
const buffer = Buffer.alloc(44 + N * 4);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + N * 4, 4);
buffer.write('WAVEfmt ', 8);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(2, 22);
buffer.writeUInt32LE(SR, 24);
buffer.writeUInt32LE(SR * 4, 28);
buffer.writeUInt16LE(4, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(N * 4, 40);
for (let index = 0; index < N; index += 1) {
  const fade = Math.min(1, (N - index) / SR);
  for (const [channel, samples] of [[0, left], [1, right]]) {
    const value = Math.tanh((samples[index] / (peak || 1)) * 1.4) * 0.85 * fade;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 4 + channel * 2);
  }
}
mkdirSync('assets', { recursive: true });
writeFileSync('assets/soundtrack.wav', buffer);
console.log(`assets/soundtrack.wav ${TL.DUR.toFixed(1)}s peak ${peak.toFixed(2)}`);
