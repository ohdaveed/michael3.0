import { nav } from "./nav.js";

// Smooth scroll for same-page anchor links
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    const hash = this.getAttribute("href");
    if (!hash || hash === "#" || hash.length < 2) return;
    const id = decodeURIComponent(hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const navHeight = nav ? nav.offsetHeight : 0;
    const subnav = document.getElementById("sectionSubnav");
    const subnavHeight = subnav ? subnav.offsetHeight : 0;
    const targetPosition = target.offsetTop - navHeight - subnavHeight - 20;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({
      top: targetPosition,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  });
});
