import { navLinks } from "./nav.js";

// Only wire up hover-driven polish (underline sweep, card tilt, custom
// cursor) for mice/trackpads — touch devices have no meaningful "cursor
// position" and prefers-reduced-motion users opted out of decorative motion.
const supportsHoverPolish =
  window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// === CURSOR-AWARE NAV UNDERLINE ===
// Sets the ::after underline's transform-origin to wherever the cursor
// entered the link, so the gold line grows outward from that point
// instead of always sweeping left-to-right.
if (supportsHoverPolish && navLinks) {
  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("mouseenter", (e) => {
      const rect = link.getBoundingClientRect();
      const originPct = rect.width
        ? ((e.clientX - rect.left) / rect.width) * 100
        : 50;
      link.style.setProperty(
        "--underline-origin",
        Math.min(100, Math.max(0, originPct)) + "%",
      );
    });
  });
}

// === MAGNETIC TILT ON CARDS ===
// Subtle perspective tilt following the cursor position within the card,
// scoped to the grid cards that already have a hover-lift affordance.
if (supportsHoverPolish) {
  const tiltCards = document.querySelectorAll(
    ".doc-card, .practice-card, .case-card",
  );
  const TILT_MAX_DEG = 6;

  tiltCards.forEach((card) => {
    card.style.transformStyle = "preserve-3d";
    card.style.willChange = "transform";

    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      const rotateY = px * TILT_MAX_DEG * 2;
      const rotateX = py * -TILT_MAX_DEG * 2;
      card.style.transform =
        "perspective(800px) rotateX(" +
        rotateX.toFixed(2) +
        "deg) rotateY(" +
        rotateY.toFixed(2) +
        "deg) translateY(-3px)";
    });

    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  });
}

// === CUSTOM GOLD-RING CURSOR (dark sections only) ===
if (supportsHoverPolish) {
  const darkSections = document.querySelectorAll(
    ".hero, .practices, .cta-banner, .quiz-section, .results-highlights, #nav",
  );

  if (darkSections.length) {
    const ring = document.createElement("div");
    ring.className = "custom-cursor";
    ring.setAttribute("aria-hidden", "true");
    document.body.appendChild(ring);

    let rafId = null;
    function moveRing(x, y) {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        ring.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        rafId = null;
      });
    }

    document.addEventListener("mousemove", (e) => {
      moveRing(e.clientX, e.clientY);
    });

    darkSections.forEach((section) => {
      section.addEventListener("mouseenter", () =>
        ring.classList.add("visible"),
      );
      section.addEventListener("mouseleave", () =>
        ring.classList.remove("visible"),
      );
    });

    document
      .querySelectorAll(
        ".hero a, .hero button, .practices a, .practices button, .practice-card, .cta-banner a, .cta-banner button, .quiz-section a, .quiz-section button, .results-highlights a, .results-highlights button, #nav a, #nav button",
      )
      .forEach((el) => {
        el.addEventListener("mouseenter", () => ring.classList.add("hover"));
        el.addEventListener("mouseleave", () => ring.classList.remove("hover"));
      });
  }
}
