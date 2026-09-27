#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { RarebitBrand } from "./brand.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const siteTemplatePath = join(root, "site", "index.template.html");
const siteOutputPath = join(root, "site", "index.html");
const assetDirs = [join(root, "assets"), join(root, "site", "assets")];
const siteFontDir = join(root, "site", "fonts");
const fontFiles = {
  "Lora-Variable.ttf": "serif",
  "SourceSans3-Variable.ttf": "sans",
  "SourceCodePro-Variable.ttf": "mono",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderSite(template, withVideo) {
  const { copy } = RarebitBrand;
  const values = {
    __HEADLINE__: copy.headline,
    __SHORT_DESCRIPTION__: copy.shortDescription,
    __META_DESCRIPTION__: `${copy.shortDescription} ${copy.name} helps people recover the thread of long Pi sessions.`,
    __JOURNEY_0_TEXT__: copy.journeys[0].text,
    __JOURNEY_0_COMMAND__: copy.journeys[0].command,
    __JOURNEY_1_TEXT__: copy.journeys[1].text,
    __JOURNEY_1_COMMAND__: copy.journeys[1].command,
    __JOURNEY_2_TEXT__: copy.journeys[2].text,
    __JOURNEY_2_COMMAND__: copy.journeys[2].command,
  };
  const rendered = Object.entries(values).reduce(
    (html, [token, value]) => html.replaceAll(token, escapeHtml(value)),
    template,
  );
  if (withVideo) return rendered;
  return rendered.replace(/\s*<section class="video-section section"[\s\S]*?<\/section>/, "");
}

function parseFont(buffer) {
  return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

function fontFor(fontData, family) {
  if (family.includes("Lora")) return fontData.serif;
  if (family.includes("Source Code")) return fontData.mono;
  return fontData.sans;
}

class SvgContext {
  constructor(width, height, fontData) {
    this.width = width;
    this.height = height;
    this.fontData = fontData;
    this.nodes = [];
    this.state = { strokeStyle: "#000", fillStyle: "#000", lineWidth: 1, lineCap: "butt" };
    this.stack = [];
    this.path = [];
  }
  save() { this.stack.push({ ...this.state }); }
  restore() { this.state = this.stack.pop() ?? this.state; }
  set strokeStyle(value) { this.state.strokeStyle = value; }
  get strokeStyle() { return this.state.strokeStyle; }
  set fillStyle(value) { this.state.fillStyle = value; }
  get fillStyle() { return this.state.fillStyle; }
  set lineWidth(value) { this.state.lineWidth = value; }
  get lineWidth() { return this.state.lineWidth; }
  set lineCap(value) { this.state.lineCap = value; }
  beginPath() { this.path = []; }
  rect(x, y, width, height) { this.path.push(`M ${x} ${y} h ${width} v ${height} h ${-width} Z`); }
  arc(x, y, radius) { this.path.push(`M ${x - radius} ${y} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`); }
  moveTo(x, y) { this.path.push(`M ${x} ${y}`); }
  lineTo(x, y) { this.path.push(`L ${x} ${y}`); }
  stroke() { this.nodes.push(`<path d="${this.path.join(" ")}" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}" stroke-linecap="${this.state.lineCap}"/>`); }
  fill() { this.nodes.push(`<path d="${this.path.join(" ")}" fill="${this.fillStyle}"/>`); }
  roundRect(x, y, width, height, radius) { this.nodes.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${this.fillStyle}"/>`); }
  text(value, x, y, { size = 16, family = RarebitBrand.tokens.fonts.body, fill = RarebitBrand.tokens.colors.ink, anchor = "start" } = {}) {
    const font = fontFor(this.fontData, family);
    const text = String(value);
    const width = font.getAdvanceWidth(text, size, { kerning: true });
    const start = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    const path = font.getPath(text, start, y, size, { kerning: true });
    this.nodes.push(`<path d="${path.toPathData(2)}" fill="${fill}"/>`);
  }
  finish(extra = "") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}" role="img">${extra}${this.nodes.join("")}</svg>\n`;
  }
}

function headerLogoSvg(fontData) {
  const c = new SvgContext(180, 72, fontData);
  RarebitBrand.drawLogo(c, 25, 36, 34);
  c.text("rarebit", 53, 47, { size: 32, family: RarebitBrand.tokens.fonts.display, fill: RarebitBrand.tokens.colors.ink });
  return c.finish('<title>Rarebit</title>');
}

function logoSvg(fontData) {
  const c = new SvgContext(720, 220, fontData);
  c.fillStyle = RarebitBrand.tokens.colors.paperBright;
  c.roundRect(0, 0, 720, 220, 24);
  RarebitBrand.drawLogo(c, 116, 110, 92);
  c.text("rarebit", 192, 133, { size: 76, family: RarebitBrand.tokens.fonts.display, weight: 600 });
  c.text("recover the thread", 198, 169, { size: 17, family: RarebitBrand.tokens.fonts.mono, fill: RarebitBrand.tokens.colors.muted });
  return c.finish('<title>Rarebit — recover the thread</title>');
}

function markSvg(fontData, kind) {
  const c = new SvgContext(96, 96, fontData);
  RarebitBrand.drawMark(c, kind, 48, 48, 38);
  return c.finish(`<title>${kind.replaceAll("_", " ")}</title>`);
}

function posterSvg(fontData) {
  const c = new SvgContext(1600, 900, fontData);
  const { colors, fonts } = RarebitBrand.tokens;
  c.fillStyle = colors.paper;
  c.roundRect(0, 0, 1600, 900, 0);
  c.fillStyle = colors.dark;
  c.roundRect(88, 82, 1424, 736, 28);
  c.text("RAREBIT", 148, 164, { size: 19, family: fonts.mono, weight: 600, fill: "#9bb7a2" });
  c.text("Catch up. Keep the thread.", 148, 270, { size: 74, family: fonts.display, weight: 600, fill: colors.darkText });
  c.text("A visual story about selected conversation on the active branch.", 148, 326, { size: 23, fill: "#b9cfc0" });
  c.fillStyle = colors.paperBright;
  c.roundRect(130, 434, 1340, 210, 16);
  c.strokeStyle = colors.rule;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(168, 530);
  c.lineTo(1350, 530);
  c.stroke();
  const marks = [[310, "user_message", "Keep the public API unchanged."], [700, "agent_continuation", "I’ll check the cache key."], [1070, "agent_stop", "Cache fix ready for review."]];
  for (const [x, kind, label] of marks) {
    RarebitBrand.drawMark(c, kind, x, 530, kind === "agent_continuation" ? 25 : 42);
    c.text(label, x, 600, { size: 18, fill: colors.ink, anchor: "middle" });
  }
  c.text("tool traffic recedes · source evidence remains", 148, 746, { size: 18, family: fonts.mono, fill: "#9bb7a2" });
  return c.finish('<title>Rarebit — promo video poster</title>');
}

function faviconSvg(fontData) {
  const c = new SvgContext(128, 128, fontData);
  c.fillStyle = RarebitBrand.tokens.colors.paperBright;
  c.roundRect(0, 0, 128, 128, 24);
  RarebitBrand.drawLogo(c, 64, 64, 72);
  return c.finish('<title>Rarebit</title>');
}

function bannerSvg(fontData) {
  const c = new SvgContext(1600, 500, fontData);
  const { colors, fonts } = RarebitBrand.tokens;
  c.fillStyle = colors.paper;
  c.roundRect(0, 0, 1600, 500, 0);
  c.fillStyle = colors.dark;
  c.roundRect(88, 42, 1424, 416, 28);
  c.text("RAREBIT", 148, 112, { size: 19, family: fonts.mono, weight: 600, fill: "#9bb7a2" });
  c.text("Catch up. Keep the thread.", 148, 190, { size: 62, family: fonts.display, weight: 600, fill: colors.darkText });
  c.text("Selected conversation from the active branch of a long Pi session.", 148, 232, { size: 20, fill: "#b9cfc0" });
  c.fillStyle = colors.paperBright;
  c.roundRect(130, 270, 1340, 150, 16);
  c.strokeStyle = colors.rule;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(168, 320);
  c.lineTo(1350, 320);
  c.stroke();
  const marks = [
    [310, "user_message", "Keep the public API unchanged."],
    [700, "agent_continuation", "I’ll check the cache key."],
    [1070, "agent_stop", "Cache fix ready for review."],
  ];
  for (const [x, kind, label] of marks) {
    RarebitBrand.drawMark(c, kind, x, 320, kind === "agent_continuation" ? 25 : 42);
    c.text(label, x, 380, { size: 18, fill: colors.ink, anchor: "middle" });
  }
  c.text("tool traffic recedes · source evidence remains", 148, 426, { size: 18, family: fonts.mono, fill: "#9bb7a2" });
  return c.finish('<title>Rarebit — catch up on long Pi sessions</title>');
}

async function main() {
  const fontBuffers = {
    serif: await readFile(join(root, "fonts", "Lora-Variable.ttf")),
    sans: await readFile(join(root, "fonts", "SourceSans3-Variable.ttf")),
    mono: await readFile(join(root, "fonts", "SourceCodePro-Variable.ttf")),
  };
  const fonts = {
    serif: parseFont(fontBuffers.serif),
    sans: parseFont(fontBuffers.sans),
    mono: parseFont(fontBuffers.mono),
  };
  const outputs = {
    "logo.svg": logoSvg(fonts),
    "header-logo.svg": headerLogoSvg(fonts),
    "banner.svg": bannerSvg(fonts),
    "poster.svg": posterSvg(fonts),
    "mark-user.svg": markSvg(fonts, "user_message"),
    "mark-continuation.svg": markSvg(fonts, "agent_continuation"),
    "mark-stop.svg": markSvg(fonts, "agent_stop"),
    "mark-error.svg": markSvg(fonts, "terminal_error"),
  };
  const rasterOutputs = {
    "social-preview.png": Buffer.from(new Resvg(outputs["poster.svg"], { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: false } }).render().asPng()),
    "favicon.png": Buffer.from(new Resvg(faviconSvg(fonts), { fitTo: { mode: "width", value: 128 }, font: { loadSystemFonts: false } }).render().asPng()),
  };
  const check = process.argv.includes("--check");
  const site = process.argv.includes("--site");
  const withVideo = process.argv.includes("--with-video");
  const brandData = `window.RarebitBrandData = Object.freeze(${JSON.stringify({ tokens: RarebitBrand.tokens })});\n`;
  const siteHtml = renderSite(await readFile(siteTemplatePath, "utf8"), withVideo);
  if (!check && !site && process.argv.length > 2) {
    throw new Error("Usage: node brand/build-assets.mjs [--check|--site] [--with-video]");
  }
  const videoConfig = `window.RarebitVideoConfig = Object.freeze(${JSON.stringify(withVideo ? { src: "https://github.com/deephbz/rarebit/releases/download/v0.2.0/rarebit-promo.mp4" } : { src: null })});\n`;
  if (!check) {
    for (const dir of assetDirs) await mkdir(dir, { recursive: true });
    await mkdir(siteFontDir, { recursive: true });
  }
  const failures = [];
  const outputDirs = check
    ? [assetDirs[0], ...(existsSync(assetDirs[1]) ? [assetDirs[1]] : [])]
    : assetDirs;
  for (const dir of outputDirs) {
    for (const [name, content] of Object.entries(outputs)) {
      const path = join(dir, name);
      if (check) {
        let current;
        try { current = await readFile(path, "utf8"); } catch { current = null; }
        if (current !== content) failures.push(path);
      } else {
        await writeFile(path, content);
      }
    }
  }
  for (const [name, content] of Object.entries(rasterOutputs)) {
    for (const dir of outputDirs) {
      const path = join(dir, name);
      if (check) {
        let current;
        try { current = await readFile(path); } catch { current = null; }
        if (!current || !current.equals(content)) failures.push(path);
      } else {
        await writeFile(path, content);
      }
    }
  }
  if (check && existsSync(siteOutputPath)) {
    let current;
    try { current = await readFile(siteOutputPath, "utf8"); } catch { current = null; }
    if (current !== siteHtml) failures.push(siteOutputPath);
  } else if (!check) {
    await writeFile(siteOutputPath, siteHtml);
  }
  const dataPath = join(root, "site", "brand-data.js");
  const videoPath = join(root, "site", "video-config.js");
  if (check && existsSync(dataPath)) {
    let current;
    try { current = await readFile(dataPath, "utf8"); } catch { current = null; }
    if (current !== brandData) failures.push(dataPath);
  } else if (!check) {
    await writeFile(dataPath, brandData);
  }
  if (check && existsSync(videoPath)) {
    let current;
    try { current = await readFile(videoPath, "utf8"); } catch { current = null; }
    if (current !== videoConfig) failures.push(videoPath);
  } else if (!check) {
    await writeFile(videoPath, videoConfig);
  }
  for (const [file, key] of Object.entries(fontFiles)) {
    const source = fontBuffers[key];
    const path = join(siteFontDir, file);
    if (check && existsSync(siteFontDir)) {
      let current;
      try { current = await readFile(path); } catch { current = null; }
      if (!current || !current.equals(source)) failures.push(path);
    } else if (!check) {
      await writeFile(path, source);
    }
  }
  if (check && failures.length) {
    throw new Error(`Generated asset drift:\n${failures.join("\n")}`);
  }
  if (check) console.log("brand assets: clean");
  else console.log(`brand assets: wrote ${Object.keys(outputs).length} assets to ${assetDirs.length} targets`);
}

await main();
