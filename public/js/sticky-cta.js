import { useScroll } from "./hooks.js";

const stickyCta = document.getElementById("stickyCta");

if (stickyCta) {
  useScroll(
    (isPassed) => {
      stickyCta.classList.toggle("visible", isPassed);
    },
    () => window.innerHeight * 0.8,
  );
}
