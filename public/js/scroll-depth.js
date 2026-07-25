// GA4 scroll-depth tracking for long-form marketing pages, where "did they
// read this" matters most. Contact/thank-you aren't included — scroll depth
// isn't a meaningful signal on a short transactional page.
const TRACKED_PAGES = [
  "services.html",
  "results.html",
  "faq.html",
  "what-to-expect.html",
];
const THRESHOLDS = [25, 50, 75, 90];

const page = window.location.pathname.split("/").pop() || "index.html";
if (TRACKED_PAGES.includes(page)) {
  const fired = new Set();
  let ticking = false;

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(checkScroll);
    }
  };

  function checkScroll() {
    ticking = false;
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    if (scrollable <= 0) return;
    const percent = (window.scrollY / scrollable) * 100;

    for (const threshold of THRESHOLDS) {
      if (percent >= threshold && !fired.has(threshold)) {
        fired.add(threshold);
        if (typeof window.gtag === "function") {
          window.gtag("event", "scroll_depth", {
            percent_scrolled: threshold,
            page_path: window.location.pathname,
          });
        }
      }
    }

    if (fired.size === THRESHOLDS.length) {
      window.removeEventListener("scroll", onScroll);
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
}
