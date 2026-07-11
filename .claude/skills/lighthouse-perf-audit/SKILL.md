---
name: lighthouse-perf-audit
description: Runs Lighthouse against the local dev server and translates the report's Performance/SEO/Best-Practices scores into concrete, prioritized fixes for this site. Use when the user asks to check performance, run Lighthouse, improve page speed, or audit Core Web Vitals.
---

# Lighthouse Performance Audit

`npm run lighthouse` produces `lighthouse-report.html` but nothing reads it
for the user — it's a raw report meant for a browser. This skill runs it and
translates results into action items, aware of what's already optimized in
this repo (`vite-plugin-image-optimizer`, `sharp`, `svgo`) versus what's a
new, real problem.

## Steps

1. **Ensure the dev server is running** (`npm run dev`, port 5173) — same
   requirement as `a11y:check`, Lighthouse needs a live URL.

2. **Run Lighthouse per key page**, not just the homepage:
   `npm run lighthouse` only audits `/` by default. For other pages, run
   directly: `npx lighthouse http://localhost:5173/<page>.html --output=html
--output-path=./lighthouse-<page>.html --chrome-flags="--headless=new
--no-sandbox"`. Prioritize `index.html` and `contact.html` (highest
   business value — the conversion page).

3. **Read the generated HTML report** rather than assuming — parse category
   scores (Performance, Accessibility, Best Practices, SEO) and the specific
   audit failures listed under each.

4. **Contextualize findings against this repo's setup before recommending
   fixes:**
   - Image weight issues: check if the flagged image is already passing
     through `ViteImageOptimizer` (configured in `vite.config.js` at quality
     80 for png/jpeg/jpg/webp, multipass for svg) — if yes, the fix is
     re-sizing/serving smaller dimensions, not "add compression" (already
     covered). Route follow-up work to `image-asset-optimize`.
   - Render-blocking resources: this is a static Vite site with no framework
     — check `public/*.html` `<head>` for unminified/unbundled third-party
     scripts (e.g. GA4 `gtag/js`, hardcoded per CLAUDE.md in `index.html`)
     as the likely cause, not application code.
   - Unused CSS/JS: check `public/css/styles.css` and `public/js/main.js` are
     shared across all pages (per CLAUDE.md) — "unused CSS" on one page may
     be used on another; don't recommend deleting shared rules without
     checking cross-page usage.
   - Accessibility score in the report: defer to `a11y-audit` for detailed
     triage — don't duplicate that work here, just flag the score.

5. **Report** scores per page plus a short list of the highest-impact fixes
   (Lighthouse weights these — lead with what actually moves the score, not
   every minor audit warning).

## When NOT to use

For accessibility-specific triage use `a11y-audit`. For SEO tag/schema
correctness (not Lighthouse's SEO heuristics) use `seo-schema-check`.
