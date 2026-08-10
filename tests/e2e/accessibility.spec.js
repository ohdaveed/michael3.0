import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.js";

// Automated axe-core scan of the primary pages, complementing (not replacing)
// the hand-written ARIA assertions in navigation.spec.js and faq.spec.js,
// which cover interaction states axe cannot reach on a static page.
//
// The blockThirdParty fixture from fixtures.js is auto-applied, so the scan
// never depends on Google Fonts or GTM loading.

// Reduced motion is required for coverage, not just stability. js/scroll-reveal.js
// gives `.animate` an opacity of 0 until it scrolls into view, and axe skips
// invisible elements outright — so without this, most of every page below the
// fold is never scanned at all, and whatever is mid-fade is sampled at a
// blended colour that never settles on screen. The `@media (prefers-reduced-
// motion: reduce)` block in css/base/accessibility.css forces `.animate` back
// to opacity 1, which both settles the transitions and makes the whole page
// visible to the scan.
//
// This has to be emulateMedia rather than `test.use({ reducedMotion })`:
// under Playwright 1.61.1 the context option leaves the media query matching
// `no-preference`, so the override never applies. That is how the two rules
// below stayed disabled while the failures they describe went unfixed — and
// how a page could be reported clean while three quarters of it went unread.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

// Guards the above: if reduced motion silently stops applying again, the scan
// quietly shrinks to the above-the-fold content instead of failing, so assert
// the media query actually took hold before trusting any page's result.
test("reduced motion is actually emulated", async ({ page }) => {
  await page.goto("/index.html");
  const state = await page.evaluate(() => ({
    matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    revealed: getComputedStyle(document.querySelector(".animate")).opacity,
  }));
  expect(state).toEqual({ matches: true, revealed: "1" });
});

// Every built page. The four beyond the primary seven were the ones carrying
// the worst violations — the legal trio's entire nav failed, unscanned.
const PAGES = [
  "/index.html",
  "/services.html",
  "/process.html",
  "/results.html",
  "/faq.html",
  "/what-to-expect.html",
  "/contact.html",
  "/thank-you.html",
  "/privacy-policy.html",
  "/disclaimer.html",
  "/attorney-advertising.html",
];

for (const path of PAGES) {
  test(`${path} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // Map before asserting so a failure prints the rule and the offending
    // selectors rather than a wall of axe's full node objects.
    expect(
      violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
    ).toEqual([]);
  });
}
