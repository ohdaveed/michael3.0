# E2E test coverage expansion — design

Date: 2026-07-15
Status: Approved

## Context

`tests/e2e/send-a-message.spec.js` (added in commit `9df9b0b`) is currently
the only Playwright coverage on this site. Everything else — nav, FAQ
accordion, quiz, probate calculator, funding checklist, onboarding tour,
sticky CTA, and the site's only custom GA4 event (`book_consult_click`) —
has zero automated coverage. The README's manual "Testing checklist (before
launch)" also duplicates several of these as human-run steps.

## Goal

Automate the interactive surface of the site (README checklist items plus
all interactive widgets) as Playwright E2E specs, following the mocking and
structuring conventions already established in `send-a-message.spec.js`.

## Scope

New files under `tests/e2e/`, one per feature:

| File                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigation.spec.js`         | Mobile menu open/close (`.mobile-toggle`), Escape-to-close, focus management (first-link-on-open via `nav.js`, focus-to-toggle-on-close), Tab focus trap while open, `inert` on `main`/`footer` and body scroll lock while open, `aria-current` on the active nav link. Run against 2 representative pages (`index.html`, `faq.html`) — the nav partial is identical sitewide, so a full 11-page sweep adds no signal. |
| `faq.spec.js`                | Accordion expand/collapse and `aria-expanded`/`hidden` sync (`faq.js`); Fuse.js search filtering, clear button, empty-state display, live-region result count.                                                                                                                                                                                                                                                         |
| `quiz.spec.js`               | Start → answer questions → result view (`quiz.js`, `index.html`); progress bar/label updates as questions advance.                                                                                                                                                                                                                                                                                                     |
| `probate-calculator.spec.js` | Input/slider sync, calculated probate cost + savings output (`probate-calculator.js`, `index.html`).                                                                                                                                                                                                                                                                                                                   |
| `funding-checklist.spec.js`  | Checkbox state, progress bar/label updates, `localStorage` persistence across reload (`funding-checklist.js`, `services.html`).                                                                                                                                                                                                                                                                                        |
| `onboarding-tour.spec.js`    | driver.js tour launches on `#start-tour-btn` click, first step popover visible, advance/close (`onboarding-tour.js`, `process.html`).                                                                                                                                                                                                                                                                                  |
| `sticky-cta.spec.js`         | Hidden on load, visible after scrolling past 80% of viewport height (`sticky-cta.js`), hidden again on scroll-up.                                                                                                                                                                                                                                                                                                      |
| `analytics.spec.js`          | `book_consult_click` GA4 event (`analytics.js`) fires with the correct `link_location` when a `[data-cta="book-consult"]` link is clicked, from at least nav, sticky-cta, and hero locations. This is the only custom GA4 event in the codebase and sits on the primary conversion action; it currently has zero coverage.                                                                                             |

### Explicitly out of scope for this round

- **Full link-integrity crawl.** `npm run links:check` (linkinator) already
  covers this locally against the dev server. It isn't wired into CI —
  that's a separate, smaller follow-up, not part of this spec.
- **Smooth-scroll pixel-position assertions.** Low signal in Playwright;
  easy to visually regress without failing a coordinate check.
- **Stat-counter animation.** Cosmetic only, no functional/conversion risk.

## Approach

Follow the conventions in `send-a-message.spec.js`:

- Block third-party noise not under test (`googletagmanager.com`,
  `fonts.(googleapis|gstatic).com`) via `page.route(...).abort()`.
- For `analytics.spec.js`, stub `window.gtag` before navigation
  (`page.addInitScript`) to capture call arguments instead of letting
  requests reach GA, mirroring how `tally-embed.js` is exercised today via
  `window.dataLayer` polling.
- One `test.describe` block per feature/page, matching the existing file's
  structure.
- Reuse `mockTally`-style helpers only where a spec actually touches the
  contact form; the new specs are otherwise independent of Tally.

## CI impact

Today `playwright.config.js` sets `workers: process.env.CI ? 1 : undefined`
— serial execution in CI. Adding 8 files on top of the existing 2
`test.describe` blocks will noticeably slow CI wall-clock time under serial
execution. This spec includes bumping CI to a small worker pool
(`workers: 2` when `process.env.CI`, `fullyParallel: true` stays as-is) as
part of the same change, not a separate follow-up.

## Testing

The specs themselves are the deliverable. Validation is: `npm run test:e2e`
passes locally and in CI (`npm run check` + `test:e2e` job in
`.github/workflows/ci.yml`), and each new spec fails if the corresponding
`public/js/*.js` behavior is reverted (spot-checked by temporarily breaking
one assertion per file during implementation).

## Delivery

8 independent spec files — implemented and committed one at a time
(subagent-driven-development), so progress survives interruption per this
repo's workflow conventions.
