---
name: seo-schema-check
description: Verifies canonical URLs, Open Graph tags, and JSON-LD schema stay consistent across every public/*.html page and match sitemap.xml/robots.txt. Use when the user asks to check SEO, audit meta tags, verify schema markup, or after adding/renaming a page or changing the site's hostname.
---

# SEO / Schema Consistency Check

CLAUDE.md flags this explicitly: canonical URLs, Open Graph tags, and JSON-LD
in every page's `<head>` assume the live site is `https://www.lehr-law.com/`.
If that ever changes, it needs a search-and-replace across every
`public/*.html`, `sitemap.xml`, and `robots.txt` — and nothing currently
verifies they stay in sync. This skill is that verification pass.

## Steps

1. **List every page under `public/`** that should be indexed (exclude
   `thank-you.html`, which is intentionally `noindex` and excluded from the
   sitemap via `Sitemap({ exclude: ["/thank-you", "/thank-you.html"] })` in
   `vite.config.js`).

2. **For each indexed page, check:**
   - `<link rel="canonical" href="...">` — must be `https://www.lehr-law.com/`
     - the correct path, and must match the page's actual route (watch for
       trailing-slash inconsistency, e.g. `/` vs `/index.html`).
   - `<meta property="og:url" content="...">` — must match the canonical URL.
   - `<meta name="robots" content="...">` — should be `index, follow` on
     public pages, `noindex` only on `thank-you.html`.
   - JSON-LD blocks (`<script type="application/ld+json">`) — check `@id`/
     `url` fields match the canonical, and that structured data type is
     appropriate (e.g. `LegalService`/`Attorney` fields, `openingHours`).
     Flag but do not add `aggregateRating` or review schema — CLAUDE.md and
     `lehr-law-copy-qa` both prohibit this without substantiated reviews.

3. **Cross-check against `sitemap.xml`** (generated at build time by
   `vite-plugin-sitemap` from `hostname: "https://www.lehr-law.com/"` in
   `vite.config.js`, output to `dist/`) — every indexed page should appear
   exactly once, with `thank-you` correctly excluded. If checking the repo
   root `sitemap.xml` (pre-build, deployed alongside `robots.txt` per
   `deploy.yml`), verify it's not stale relative to the actual page list.

4. **Cross-check `robots.txt`** — confirm it doesn't block any indexed page
   and correctly disallows `thank-you.html` if listed at all.

5. **Cross-page consistency** (also covered by `lehr-law-copy-qa`, but check
   the machine-readable versions here): phone number, address, and business
   hours in JSON-LD must match what's visibly rendered and match across all
   pages — a mismatch between visible copy and schema is a common SEO/trust
   issue.

6. **Report** a table: page → canonical OK/mismatch → og:url OK/mismatch →
   in sitemap Y/N → JSON-LD issues. Only report actionable mismatches, not a
   restatement of tags that are already correct.

## When NOT to use

Use `lehr-law-copy-qa` for the human-readable copy/tone/voice review;
use `lighthouse-perf-audit` for Lighthouse's own SEO category score
(meta description length, mobile-friendliness, etc.) rather than
schema/canonical correctness, which this skill owns.
