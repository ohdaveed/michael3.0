import { useIntersectionObserver } from "./hooks.js";

// Scroll-triggered animations
// threshold 0.15 + a -40px bottom margin means an element must be 15% visible
// and already 40px past the viewport edge before it fades in — avoids
// triggering the animation the instant a section's top pixel appears.
useIntersectionObserver(
  ".animate",
  (entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
);
