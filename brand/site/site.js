const brand = window.RarebitBrandData;

if (brand) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(brand.tokens.colors)) {
    root.style.setProperty(`--brand-${name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, value);
  }
  for (const [name, value] of Object.entries(brand.tokens.fonts)) {
    root.style.setProperty(`--brand-font-${name}`, value);
  }
}

const video = document.querySelector("#promo-video");
const videoSection = video?.closest(".video-section");
if (video && videoSection && window.RarebitVideoConfig?.src) {
  const source = document.createElement("source");
  source.src = window.RarebitVideoConfig.src;
  source.type = "video/mp4";
  video.append(source);
  videoSection.hidden = false;
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Hero extraction. The sieve sweeps the session card. Each tool row crumbles
// into grains that fall to a pile and leaves a ghost rule; each rare bit is
// caught and then gathers into the clean column (.done in styles.css).
// Grain positions are percentages of the stage, so a resize keeps the pile.
const stage = document.querySelector("#extract");
const replay = document.querySelector("#replay");
let timers = [];
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}
// The kept pile: deterministic end positions in stage percentages.
function grainTargets(count, random) {
  return Array.from({ length: count }, () => {
    const spread = random() + random() + random() - 1.5;
    const x = 40 + spread * 22;
    const mound = 6 * Math.max(0, 1 - (spread / 1.5) ** 2);
    return { x, y: 97 - random() * mound, dark: random() < 0.3 };
  });
}
function addGrain({ x, y, dark }) {
  const grain = document.createElement("span");
  grain.className = dark ? "grain dark" : "grain";
  grain.style.left = `${x}%`;
  grain.style.top = `${y}%`;
  stage.append(grain);
  return grain;
}
function layoutBits() {
  // Settled column: stack each rare bit by its measured height.
  let top = parseFloat(getComputedStyle(stage).getPropertyValue("--top")) + 12;
  for (const row of stage.querySelectorAll(".row.rare")) {
    const height = row.querySelector(".serif").offsetHeight + 14;
    row.style.setProperty("--final-top", `${top}px`);
    row.style.setProperty("--final-height", `${height}px`);
    top += height;
  }
  const next = stage.querySelector(".next");
  next.style.top = `${top + 6}px`;
  stage.style.setProperty("--settled-height", `${top + next.offsetHeight + 140}px`);
}
function resetStage() {
  for (const id of timers) clearTimeout(id);
  timers = [];
  stage.classList.remove("done", "running");
  stage.querySelectorAll(".grain").forEach((node) => node.remove());
  stage.querySelectorAll(".row").forEach((row) => {
    row.classList.remove("caught", "fallen");
    row.getAnimations().forEach((animation) => animation.cancel());
  });
  stage.querySelector(".sieve").getAnimations().forEach((animation) => animation.cancel());
}
function settle() {
  resetStage();
  for (const row of stage.querySelectorAll(".row.rare")) row.classList.add("caught");
  grainTargets(260, seeded(11)).forEach(addGrain);
  layoutBits();
  stage.classList.add("done");
}
function runExtraction() {
  resetStage();
  layoutBits();
  stage.classList.add("running");
  const height = stage.clientHeight;
  const width = stage.clientWidth;
  const sweep = 3000, begin = 400;
  stage.querySelector(".sieve").animate(
    [{ opacity: 1, transform: "translateY(0)" }, { opacity: 1, transform: `translateY(${height - 40}px)` }],
    { delay: begin, duration: sweep, easing: "linear" },
  );
  const random = seeded(7);
  for (const row of stage.querySelectorAll(".row")) {
    const y = row.offsetTop + row.offsetHeight / 2;
    const at = begin + sweep * ((y - 40) / (height - 40));
    if (row.classList.contains("rare")) {
      later(at, () => row.classList.add("caught"));
      continue;
    }
    const text = row.querySelector(".mono");
    const left = row.offsetLeft + text.offsetLeft;
    const rowWidth = Math.min(text.scrollWidth, row.clientWidth - text.offsetLeft);
    later(at, () => {
      row.classList.add("fallen");
      const targets = grainTargets(Math.max(6, Math.round(rowWidth / 9)), random);
      for (const target of targets) {
        const grain = addGrain(target);
        const x0 = left + random() * rowWidth;
        const dx = x0 - (target.x / 100) * width, dy = y - (target.y / 100) * height;
        grain.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          { delay: random() * 160, duration: 700 + random() * 500, easing: "cubic-bezier(.45, 0, .9, .6)", fill: "backwards" },
        );
      }
    });
  }
  later(begin + sweep + 500, () => { layoutBits(); stage.classList.remove("running"); stage.classList.add("done"); });
}
if (stage) {
  const canAnimate = !prefersReducedMotion && "animate" in stage && "IntersectionObserver" in window;
  if (!canAnimate) settle();
  else {
    replay.hidden = false;
    replay.addEventListener("click", runExtraction);
    // Start when the card is on screen, so phone readers see the motion too.
    const start = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && document.visibilityState === "visible") {
        start.disconnect();
        (document.fonts?.ready ?? Promise.resolve()).then(runExtraction);
      }
    }, { threshold: 0.4 });
    start.observe(stage);
  }
  // Web fonts change the settled line heights; measure again once they load.
  document.fonts?.ready.then(() => { if (stage.classList.contains("done")) layoutBits(); });
  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (stage.classList.contains("running")) settle();
      else if (stage.classList.contains("done")) layoutBits();
    }, 150);
  });
}

if (!prefersReducedMotion && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.add("reveal");
    observer.observe(section);
  });
}
