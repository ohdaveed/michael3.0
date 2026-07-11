import { useIntersectionObserver } from "./hooks.js";

// === PROCESS TIMELINE (process.html) ===
// A vertical line connecting the step badges, filling up to whichever
// badge is highest as the user scrolls — measured against real layout
// (not hardcoded pixel math) so it stays correct regardless of how tall
// any given step's copy makes its card.
(function () {
  const wrap = document.querySelector(".process-timeline");
  const track = document.querySelector(".process-timeline-track");
  const fill = document.getElementById("processTimelineFill");
  const badges = Array.from(
    document.querySelectorAll(".process-step-number span"),
  );
  const steps = Array.from(document.querySelectorAll(".process-step"));

  if (!wrap || !track || !fill || !badges.length || !steps.length) return;

  let badgeCenters = [];

  function measure() {
    const wrapRect = wrap.getBoundingClientRect();
    badgeCenters = badges.map((badge) => {
      const r = badge.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - wrapRect.left,
        y: r.top + r.height / 2 - wrapRect.top,
      };
    });
    const first = badgeCenters[0];
    const last = badgeCenters[badgeCenters.length - 1];
    track.style.left = first.x + "px";
    track.style.top = first.y + "px";
    track.style.height = Math.max(0, last.y - first.y) + "px";
  }

  measure();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 150);
  });

  let reachedIndex = -1;
  function markReached(index) {
    if (index <= reachedIndex || !badgeCenters.length) return;
    reachedIndex = index;

    const trackHeight = track.offsetHeight;
    const first = badgeCenters[0];
    const target = badgeCenters[index];
    const pct = trackHeight ? ((target.y - first.y) / trackHeight) * 100 : 0;
    fill.style.height = Math.min(100, Math.max(0, pct)) + "%";

    for (let i = 0; i <= index; i++) {
      badges[i].classList.add("reached");
    }
  }

  useIntersectionObserver(
    steps,
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          markReached(steps.indexOf(entry.target));
        }
      });
    },
    { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
  );
})();
