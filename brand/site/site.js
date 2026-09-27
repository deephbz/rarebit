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

const toggle = document.querySelector("#trace-toggle");
const demoCard = toggle?.closest(".demo-card");
const supporting = [...document.querySelectorAll("[data-supporting]")];
if (toggle && supporting.length) {
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    demoCard?.classList.toggle("is-expanded", !open);
    for (const row of supporting) row.hidden = open;
    toggle.firstChild.textContent = open
      ? "Show supporting fictional traffic "
      : "Hide supporting fictional traffic ";
    toggle.querySelector("span").textContent = open ? "+" : "−";
  });
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
