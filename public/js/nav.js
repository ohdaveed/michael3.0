import { useScroll } from "./hooks.js";

export const nav = document.getElementById("nav");
export const navLinks = document.querySelector(".nav-links");

const main = document.querySelector("main");
const footer = document.querySelector("footer");
const mobileToggle = document.querySelector(".mobile-toggle");

if (nav) {
  nav.setAttribute("aria-label", "Primary");
}

function normalizePathname(pathname) {
  const last = pathname.split("/").filter(Boolean).pop();
  return last || "index.html";
}

function setCurrentNavLink() {
  if (!navLinks) return;
  const currentPath = normalizePathname(window.location.pathname);
  const currentHash = window.location.hash;
  const matchingLinks = [];

  navLinks
    .querySelectorAll("a[aria-current]")
    .forEach((link) => link.removeAttribute("aria-current"));

  navLinks.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;

    const linkUrl = new URL(href, window.location.href);
    const linkPath = normalizePathname(linkUrl.pathname);
    const hashOnlyMatch = href.startsWith("#") && href === currentHash;
    const samePage = linkPath === currentPath;
    const hashMatches = !linkUrl.hash || linkUrl.hash === currentHash;

    if ((samePage && hashMatches) || hashOnlyMatch) {
      matchingLinks.push(link);
    }
  });

  const nonCtaMatch = matchingLinks.find(
    (link) => !link.classList.contains("nav-cta"),
  );
  const activeLink = nonCtaMatch || matchingLinks[0];
  if (activeLink) {
    activeLink.setAttribute("aria-current", "page");
  }
}

setCurrentNavLink();

// Matches the breakpoint in css/responsive/general.css where .nav-links flips
// to display:none and .mobile-toggle appears. Above it the links are always
// visible, so they must never be aria-hidden.
const mobileNavQuery = window.matchMedia("(max-width: 1024px)");

// Only meaningful in the mobile layout. On desktop the links are visible and
// focusable, and marking them aria-hidden hides real tab stops from assistive
// tech (axe: aria-hidden-focus). Below the breakpoint the closed menu is
// display:none, which already removes it from the tab order, and aria-hidden
// keeps assistive tech in step with that.
function syncNavLinksHidden(isOpen) {
  if (!navLinks) return;
  if (mobileNavQuery.matches) {
    navLinks.setAttribute("aria-hidden", String(!isOpen));
  } else {
    navLinks.removeAttribute("aria-hidden");
  }
}

function setMobileMenuState(isOpen) {
  if (!mobileToggle || !navLinks) return;
  navLinks.classList.toggle("open", isOpen);
  mobileToggle.setAttribute("aria-expanded", isOpen);
  mobileToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  syncNavLinksHidden(isOpen);
  document.body.style.overflow = isOpen ? "hidden" : "";
  if (main) main.toggleAttribute("inert", isOpen);
  if (footer) footer.toggleAttribute("inert", isOpen);
}

if (nav) {
  useScroll((isPassed) => {
    nav.classList.toggle("scrolled", isPassed);
  }, 60);
}

// Mobile nav toggle
if (mobileToggle && navLinks) {
  mobileToggle.setAttribute("aria-haspopup", "true");
  mobileToggle.setAttribute("aria-label", "Open menu");
  syncNavLinksHidden(false);
  // Crossing the breakpoint (resize, orientation change) must re-evaluate:
  // the attribute is correct for one layout and wrong for the other.
  mobileNavQuery.addEventListener("change", () => {
    syncNavLinksHidden(navLinks.classList.contains("open"));
  });
  mobileToggle.addEventListener("click", () => {
    const isOpen = !navLinks.classList.contains("open");
    setMobileMenuState(isOpen);
    if (isOpen) {
      const firstLink = navLinks.querySelector("a");
      if (firstLink) requestAnimationFrame(() => firstLink.focus());
    } else {
      mobileToggle.focus();
    }
  });
  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      setMobileMenuState(false);
      mobileToggle.focus();
    });
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && navLinks && navLinks.classList.contains("open")) {
    setMobileMenuState(false);
    if (mobileToggle) {
      mobileToggle.focus();
    }
  }
});

if (mobileToggle && navLinks) {
  const focusableElements = navLinks.querySelectorAll("a, button");
  if (focusableElements.length > 0) {
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    navLinks.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && navLinks.classList.contains("open")) {
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    });
  }
}
