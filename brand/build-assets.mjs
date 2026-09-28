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
  "EBGaramond-Variable.ttf": "serif",
  "EBGaramond-Italic-Variable.ttf": "italic",
  "Jost-Variable.ttf": "sans",
  "CourierPrime-Regular.ttf": "mono",
  "CourierPrime-Bold.ttf": "monoBold",
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
    __TAGLINE__: copy.tagline,
    __EYEBROW__: copy.eyebrow,
    __INSTALL__: copy.install,
    __EXTRACT__: copy.extract,
    __META_DESCRIPTION__: `${copy.shortDescription} ${copy.name} helps people catch up on long Pi sessions.`,
  };
  copy.journeys.forEach((journey, index) => {
    values[`__JOURNEY_${index}_NAME__`] = journey.name;
    values[`__JOURNEY_${index}_LABEL__`] = journey.label;
    values[`__JOURNEY_${index}_TEXT__`] = journey.text;
    values[`__JOURNEY_${index}_COMMAND__`] = journey.command;
  });
  // Claims render as numbered notes; each links to the source that anchors it.
  const sourceUrl = (anchor) => {
    const [path, fragment] = anchor.split(/[#:]/);
    if (path === "README.md") return `https://github.com/deephbz/rarebit#${fragment}`;
    return `https://github.com/deephbz/rarebit/blob/main/${path}`;
  };
  const notes = `<ol>${copy.claims.map((claim, index) =>
    `<li id="note-${index + 1}">${escapeHtml(claim.text)} <a href="${escapeHtml(sourceUrl(claim.anchor))}"><code>${escapeHtml(claim.anchor)}</code></a></li>`).join("")}</ol>`;
  const rendered = Object.entries(values).reduce(
    (html, [token, value]) => html.replaceAll(token, escapeHtml(value)),
    template,
  ).replace("__CLAIM_NOTES__", notes);
  if (withVideo) return rendered;
  return rendered.replace(/\s*<section class="video-section section"[\s\S]*?<\/section>/, "");
}

function parseFont(buffer) {
  return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

function fontFor(fontData, family, { italic = false, weight = 400 } = {}) {
  if (family.includes("Garamond")) return italic ? fontData.italic : fontData.serif;
  if (family.includes("Courier")) return weight >= 700 ? fontData.monoBold : fontData.mono;
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
  text(value, x, y, { size = 16, family = RarebitBrand.tokens.fonts.body, fill = RarebitBrand.tokens.colors.ink, anchor = "start", italic = false, weight = 400, ls = 0 } = {}) {
    const font = fontFor(this.fontData, family, { italic, weight });
    const chars = [...String(value)];
    const advance = (ch) => font.getAdvanceWidth(ch, size, { kerning: true }) + ls;
    const width = chars.reduce((sum, ch) => sum + advance(ch), 0) - ls;
    let cursor = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    if (!ls) {
      this.nodes.push(`<path d="${font.getPath(chars.join(""), cursor, y, size, { kerning: true }).toPathData(2)}" fill="${fill}"/>`);
      return;
    }
    const parts = [];
    for (const ch of chars) {
      parts.push(font.getPath(ch, cursor, y, size).toPathData(2));
      cursor += advance(ch);
    }
    this.nodes.push(`<path d="${parts.join(" ")}" fill="${fill}"/>`);
  }
  finish(extra = "") {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}" role="img">${extra}${this.nodes.join("")}</svg>\n`;
  }
}

// Paperback Chic collateral. The wordmark is tracked Jost capitals; prose is
// EB Garamond; the cover band is the one cheddar accent.
const { colors: K, fonts: T } = RarebitBrand.tokens;

function wordmark(c, x, y, size, anchor = "start") {
  c.text("RAREBIT", x, y, { size, family: T.label, ls: size * 0.22, anchor });
}

function headerLogoSvg(fontData) {
  const c = new SvgContext(236, 72, fontData);
  RarebitBrand.drawLogo(c, 30, 36, 40);
  wordmark(c, 66, 46, 28);
  return c.finish("<title>Rarebit</title>");
}

function logoSvg(fontData) {
  const c = new SvgContext(720, 220, fontData);
  c.fillStyle = K.paperBright;
  c.roundRect(0, 0, 720, 220, 4);
  RarebitBrand.drawLogo(c, 120, 110, 110);
  wordmark(c, 206, 126, 62);
  c.text(RarebitBrand.copy.tagline, 208, 172, { size: 26, family: T.body, italic: true, fill: K.muted });
  return c.finish("<title>Rarebit — keep the rare bits</title>");
}

function markSvg(fontData, kind) {
  const c = new SvgContext(96, 96, fontData);
  RarebitBrand.drawMark(c, kind, 48, 48, 38);
  return c.finish(`<title>${kind.replaceAll("_", " ")}</title>`);
}

// A paperback cover: wordmark above, a cheddar band with the title, marks below.
function coverSvg(fontData, width, height, { title, subtitle, footer }) {
  const c = new SvgContext(width, height, fontData);
  const band = { y: height * 0.36, h: height * 0.36 };
  c.fillStyle = K.paper;
  c.roundRect(0, 0, width, height, 0);
  RarebitBrand.drawLogo(c, width / 2, height * 0.12, height * 0.11);
  wordmark(c, width / 2 + height * 0.012, height * 0.28, height * 0.1, "middle");
  c.fillStyle = K.cover;
  c.roundRect(0, band.y, width, band.h, 0);
  c.text(title, width / 2, band.y + band.h * 0.48, { size: height * 0.085, family: T.display, italic: true, anchor: "middle" });
  c.text(subtitle, width / 2, band.y + band.h * 0.8, { size: height * 0.048, family: T.display, italic: true, anchor: "middle" });
  const marks = [["user_message", "Keep the public API unchanged."], ["agent_continuation", "I’ll check the cache key."], ["agent_stop", "Cache fix ready for review."]];
  const y = band.y + band.h + height * 0.13;
  marks.forEach(([kind, label], i) => {
    const x = width * (0.22 + i * 0.28);
    RarebitBrand.drawMark(c, kind, x, y - height * 0.025, height * (kind === "agent_continuation" ? 0.05 : 0.04));
    c.text(label, x, y + height * 0.045, { size: height * 0.03, family: T.body, anchor: "middle" });
  });
  if (footer) c.text(footer, width / 2, height * 0.95, { size: height * 0.03, family: T.label, ls: height * 0.006, fill: K.muted, anchor: "middle" });
  return c;
}

function posterSvg(fontData) {
  return coverSvg(fontData, 1600, 900, { title: "Catch up on long Pi sessions.", subtitle: RarebitBrand.copy.tagline, footer: "ILLUSTRATED FICTIONAL SESSION" })
    .finish("<title>Rarebit — promo video poster</title>");
}

function faviconSvg(fontData) {
  const c = new SvgContext(128, 128, fontData);
  c.fillStyle = K.paperBright;
  c.roundRect(0, 0, 128, 128, 10);
  RarebitBrand.drawLogo(c, 64, 64, 80);
  return c.finish("<title>Rarebit</title>");
}

function bannerSvg(fontData) {
  const c = new SvgContext(1600, 500, fontData);
  c.fillStyle = K.paper;
  c.roundRect(0, 0, 1600, 500, 0);
  RarebitBrand.drawLogo(c, 120, 78, 56);
  wordmark(c, 166, 92, 34);
  c.fillStyle = K.cover;
  c.roundRect(0, 140, 1600, 220, 0);
  c.text("Keep the rare bits.", 96, 236, { size: 84, family: T.display, italic: true });
  c.text("Catch up on long Pi sessions without rereading the tool traffic.", 98, 312, { size: 30, family: T.body, italic: true });
  c.fillStyle = K.paperBright;
  c.roundRect(1040, 110, 470, 280, 2);
  const rows = [["user_message", "Keep the public API unchanged."], ["agent_continuation", "I’ll check the cache key."], ["agent_stop", "Cache fix ready for review."]];
  c.text("RARE BITS", 1076, 162, { size: 18, family: T.label, ls: 4, fill: K.muted });
  rows.forEach(([kind, label], i) => {
    const y = 222 + i * 60;
    RarebitBrand.drawMark(c, kind, 1090, y, kind === "agent_continuation" ? 26 : 22);
    c.text(label, 1118, y + 9, { size: 28, family: T.body });
  });
  c.text("Your messages and the agent’s prose. Tool traffic stays out; the source stays untouched.", 96, 440, { size: 24, family: T.body, fill: K.muted });
  return c.finish("<title>Rarebit — keep the rare bits of a long Pi session</title>");
}

async function main() {
  const fontBuffers = Object.fromEntries(await Promise.all(
    Object.entries(fontFiles).map(async ([file, key]) => [key, await readFile(join(root, "fonts", file))]),
  ));
  const fonts = Object.fromEntries(Object.entries(fontBuffers).map(([key, buffer]) => [key, parseFont(buffer)]));
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
