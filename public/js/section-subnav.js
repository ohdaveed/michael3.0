import { useIntersectionObserver } from "./hooks.js";

// === STICKY SECTION SUB-NAV (scroll-spy) ===
(function () {
  const subnav = document.getElementById("sectionSubnav");
  if (!subnav) return;

  const links = Array.from(subnav.querySelectorAll("a[href^='#']"));
  const targets = links
    .map((link) => {
      const id = decodeURIComponent(link.getAttribute("href").slice(1));
      const el = document.getElementById(id);
      return el ? { link, el } : null;
    })
    .filter(Boolean);

  if (!targets.length) return;

  function setActive(id) {
    links.forEach((link) => {
      const isActive =
        decodeURIComponent(link.getAttribute("href").slice(1)) === id;
      link.classList.toggle("active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  useIntersectionObserver(
    targets.map((t) => t.el),
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActive(entry.target.id);
        }
      });
    },
    { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
  );
})();
