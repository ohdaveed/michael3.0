# GA4 Conversion & Drop-off Tracking Plan

> **Status:** Implemented in commit `c5d96f0` (`feat(analytics): track phone/email clicks, form-page funnel, and scroll depth`). The GA4 Admin UI steps in section 4 below are manual and still outstanding.

## Context

The site currently has GA4 wired up (`G-9PV0J0XLVC`, direct gtag.js, no GTM) via [public/partials/head-analytics.html](../../../public/partials/head-analytics.html), inlined into all 11 pages at build time. Beyond automatic `page_view`, only two custom events exist: `book_consult_click` ([public/js/analytics.js](../../../public/js/analytics.js)) and `generate_lead` on Tally form submit ([public/js/tally-embed.js](../../../public/js/tally-embed.js)).

That's enough to know _that_ people convert, but not _where they drop off_. The implied funnel is:

```
Home / Services / Results / FAQ  →  Contact (Tally form)  →  Thank-you (conversion)
                                  ↘  Calendly booking (book_consult_click, tracked already)
```

There's no visibility into: how far people scroll before leaving a page, whether they click the phone number instead of filling the form (a real behavior for a law firm's clients), or — critically — whether people _start_ the contact form and abandon it partway through. Right now a form abandonment and someone who never opened the form at all look identical in GA4.

**Research findings** (why this plan is shaped the way it is):

- No MCP server exists for GA4/GTM setup (checked the MCP registry — zero results for "google analytics", "GA4", "GTM"). This has to be done as code + manual GA4 Admin UI configuration; there's no way to automate the GA4/GTM console itself from here.
- No Claude Code skill in this environment covers analytics instrumentation (checked `seo-schema-check`, `a11y-audit`, `lighthouse-perf-audit` — all adjacent, none overlapping).
- Confirmed via GA4 docs (Context7): Enhanced Measurement's automatic "Outbound clicks" was changed in Nov 2024 to **exclude** `tel:`/`mailto:`/`javascript:` links — it only fires for cross-domain `http(s)` links now. So phone-click tracking needs custom code; it will not appear for free.
- Confirmed via Tally's own docs: the embed fires a `Tally.FormPageView` postMessage event per form page, "useful for analyzing multi-page forms or drop-off rates" ([Tally docs](https://tally.so/help/track-form-events-with-google-tag-manager-or-meta-pixel)) — the same postMessage channel `tally-embed.js` already listens on for `Tally.FormSubmitted`. This gives real step-level form funnel data without adding GTM. The raw payload shape was confirmed empirically (not just from docs) by loading the live embed and inspecting the postMessage: `{"event":"Tally.FormPageView","payload":{"formId":"...","page":1}}`.

**Decision: stay on direct gtag.js, don't migrate to GTM.** GTM's main benefit is letting non-developers add/change tags without a code deploy. This is a small static site with a git-based deploy and a dev-comfortable owner — GTM would add a second script, an extra layer of indirection, and a container to maintain for no real benefit here. If that changes (e.g. marketing needs to add third-party pixels themselves), GTM is a follow-up.

## Implementation

### 1. Phone/email click tracking — `public/js/analytics.js`

Add a delegated click listener alongside the existing `book_consult_click` one, matching `a[href^="tel:"]` and `a[href^="mailto:"]`, firing `phone_click` / `email_click` with `link_location` (reuse the existing nearest-section helper) and `page_path`. No PII — the phone/email are the firm's own published contact info, not visitor data.

### 2. Contact form funnel — `public/js/tally-embed.js`

Add a second `postMessage` handler for `Tally.FormPageView` (next to the existing `Tally.FormSubmitted` one), firing `gtag('event', 'contact_form_page_view', { page: <n>, method: 'contact_form' })` using the page-index field Tally includes in that event's payload. This turns the contact form from a single opaque submit event into a real step funnel: opened → page 2 → page 3 → submitted, so drop-off inside the form becomes visible, not just before/after it. Deduped per page number (a `Set` of already-fired page numbers) so a respondent navigating back and forth inside the form doesn't inflate early-funnel step counts.

### 3. Scroll depth — new `public/js/scroll-depth.js`, imported from `js/main.js`

Fire `scroll_depth` at 25/50/75/90% thresholds per page load (`requestAnimationFrame`-throttled scroll listener, each threshold fires once), with `percent_scrolled` and `page_path` params. Scoped to the long-form marketing pages (services, results, faq, what-to-expect) where "did they actually read this" matters most — skip it on contact/thank-you where scroll isn't meaningful.

### 4. GA4 Admin UI steps (manual, documented here — not automatable)

- Verify Enhanced Measurement is ON for the property (covers automatic 90% scroll and cross-domain outbound clicks for free — no code needed for those).
- Mark `generate_lead`, `phone_click`, and `book_consult_click` as **key events** (GA4's term for conversions).
- Build a **Funnel Exploration**: Step 1 `page_view` (any page) → Step 2 `page_view` (`page_location` contains `contact.html`) → Step 3 `contact_form_page_view` → Step 4 `generate_lead` → Step 5 `page_view` (`thank-you.html`). This is what actually answers "where are people dropping off" — the code changes above just make the steps exist as events to funnel over.
- Optionally a **Path Exploration** from the homepage to see which marketing pages (services/results/faq) people visit before converting vs. bouncing.

## Files touched

- [public/js/analytics.js](../../../public/js/analytics.js) — phone/email click listeners
- [public/js/tally-embed.js](../../../public/js/tally-embed.js) — `Tally.FormPageView` listener
- [public/js/scroll-depth.js](../../../public/js/scroll-depth.js) — new module
- [public/js/main.js](../../../public/js/main.js) — imports the new module
- No changes to `head-analytics.html` or `vite.config.js` — no GTM, no env-var changes

## Verification

Done during implementation:

1. `npm run dev` + live browser inspection of `window.dataLayer` confirmed all four events (`phone_click`, `email_click`, `contact_form_page_view`, `scroll_depth`) fire with correct parameters, including the dedup fix for repeated form-page views. The existing `generate_lead` flow was regression-checked and still fires correctly.
2. `npm run check` (prettier + htmlhint) passes.
3. A code-reviewer pass caught the form-page-view dedup gap before it shipped.

Still to do:

4. After deploy, confirm events appear in GA4 Realtime, then give it a few days of traffic before building the Funnel Exploration (funnels need real event data to be useful) and completing the GA4 Admin UI steps in section 4.
