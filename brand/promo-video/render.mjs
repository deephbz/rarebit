// Headless Chrome renderer for the Rarebit promo source bundle.
//
//   node render.mjs --stills=0,8.4,29.4 --out=out/stills
//   node render.mjs --frames --workers=4
//   node render.mjs --encode --out=out/rarebit-promo.mp4
//   node render.mjs --audit            (every visible read ≥ 40 px body, ≥ 32 px label)
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map(argument => {
  const [key, value] = argument.replace(/^--/, '').split('=');
  return [key, value ?? true];
}));
new Function(readFileSync(new URL('./timeline.js', import.meta.url), 'utf8'))();
const { DUR, FPS } = globalThis.TL;
const CHROME = args.chrome || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FRAMES = 'out/frames';
const run = (command, values) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, values, { stdio: 'inherit' });
  child.on('close', code => code ? reject(new Error(`${command} exited ${code}`)) : resolvePromise());
});

if (args.encode) {
  const output = args.out || 'out/rarebit-promo.mp4';
  const audio = 'assets/soundtrack.wav';
  const inputs = ['-y', '-loglevel', 'error', '-stats', '-framerate', String(FPS), '-i', `${FRAMES}/f%05d.jpg`];
  if (existsSync(audio)) inputs.push('-i', audio);
  inputs.push('-frames:v', String(Math.round(DUR * FPS)), '-map', '0:v');
  if (existsSync(audio)) inputs.push('-map', '1:a');
  inputs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p');
  if (existsSync(audio)) inputs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  inputs.push('-movflags', '+faststart', output);
  await run('ffmpeg', inputs);
  console.log(`wrote ${output}`);
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 0,
  args: ['--allow-file-access-from-files', '--window-size=1920,1080'],
});
async function openPage() {
  const page = await browser.newPage();
  page.on('console', message => {
    if (['error', 'warn'].includes(message.type())) console.log(`[page] ${message.text()}`);
  });
  page.on('pageerror', error => console.log(`[page error] ${error.message}`));
  await page.goto(pathToFileURL(resolve('studio.html')).href + '?render', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.ready === true', { timeout: 60000 });
  return page;
}
const frameOf = async (page, time, quality = 0.93) => {
  const data = await page.evaluate((t, q) => window.renderAt(t, 'image/jpeg', q), time, quality);
  return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
};

if (args.audit) {
  const page = await openPage();
  const min = { body: 40, label: 32 };
  const failures = new Map();
  let samples = 0, smallest = Infinity;
  for (let t = 0; t < DUR; t += 0.25) {
    samples += 1;
    for (const { value, size, role } of await page.evaluate(time => window.auditAt(time), t)) {
      smallest = Math.min(smallest, size);
      if (size + 0.01 < min[role]) failures.set(`${role} ${size.toFixed(1)}px ${value}`, t);
    }
  }
  for (const [key, t] of failures) console.log(`✗ ${t.toFixed(2)}s ${key}`);
  console.log(`${samples} samples · smallest read ${smallest.toFixed(1)} px · ${failures.size} violations`);
  await browser.close();
  process.exit(failures.size ? 1 : 0);
}

if (args.stills) {
  const page = await openPage();
  const output = args.out || 'out/stills';
  mkdirSync(output, { recursive: true });
  for (const time of String(args.stills).split(',').map(Number)) {
    const name = `t${time.toFixed(2).replace('.', '_')}.jpg`;
    const path = `${output}/${name}`;
    writeFileSync(path, await frameOf(page, time));
    console.log(path);
  }
} else if (args.frames) {
  mkdirSync(FRAMES, { recursive: true });
  const total = Math.round(DUR * FPS);
  const workers = Number(args.workers || 4);
  const todo = [];
  for (let index = 0; index < total; index += 1) {
    const path = `${FRAMES}/f${String(index).padStart(5, '0')}.jpg`;
    if (!args.resume || !existsSync(path) || statSync(path).size < 1000) todo.push(index);
  }
  console.log(`${todo.length}/${total} frames to render, ${workers} workers`);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    const page = await openPage();
    while (next < todo.length) {
      const index = todo[next++];
      const path = `${FRAMES}/f${String(index).padStart(5, '0')}.jpg`;
      writeFileSync(`${path}.tmp`, await frameOf(page, index / FPS));
      renameSync(`${path}.tmp`, path);
      done += 1;
      if (done % 150 === 0 || done === todo.length) console.log(`frame ${done}/${todo.length}`);
    }
  }));
}
await browser.close();
