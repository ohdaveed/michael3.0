---
name: a11y-audit
description: Runs pa11y against the local dev server and turns raw accessibility violations into a prioritized fix list for this site's HTML/CSS. Use when the user asks to check accessibility, run an a11y audit, fix contrast/alt-text/label issues, or before shipping changes to public/*.html.
---

# Accessibility Audit

`package.json` already wires up `pa11y` (`npm run a11y:check`), but the raw
output is a flat list of WCAG rule codes with no prioritization. This skill
turns that into an actionable, page-by-page fix list.

## Steps

1. **Ensure the dev server is running.** `a11y:check` hits
   `http://localhost:5173`, not the filesystem. If nothing responds on that
   port, tell the user to run `npm run dev` in another terminal (or start it
   yourself in the background) before proceeding — do not silently skip the
   audit.

2. **Run the audit per page**, not just the homepage — `pa11y` by default
   only checks the URL you give it. List the pages under `public/` (`index`,
   `services`, `process`, `faq`, `results`, `contact`,
   `privacy-policy`, `disclaimer`, `attorney-advertising`, `thank-you`) and
   run pa11y against each: `npx pa11y http://localhost:5173/<page>.html`.
   `npm run a11y:check` alone only covers `/`.

3. **Triage findings** into:
   - **Errors** (WCAG A/AA failures — contrast ratio, missing alt text,
     unlabeled form inputs, missing `lang`, heading order skips). These block
     shipping.
   - **Warnings/notices** — usually lower priority, note but don't block on
     them unless they cluster around the same element.

4. **Group by root cause, not by page.** If the same contrast issue or
   missing-label pattern repeats across pages (this site reuses partials via
   the `<!--#include:partials/...-->` mechanism in `vite.config.js`), fix the
   shared partial once rather than patching each page.

5. **Cross-check specifics relevant to this site:**
   - Contact form (`contact.html`) uses `just-validate` — verify validation
     errors are announced to screen readers (`aria-live`, associated
     `aria-describedby`), not just visually styled.
   - FAQ accordion and mobile nav (`js/main.js`) — verify `aria-expanded` /
     `aria-controls` toggle correctly and focus is manageable via keyboard.
   - Decorative images/icons should have `alt=""`, not be missing `alt`
     entirely (pa11y flags both differently).

6. **Report** a fix list ordered by severity, each item naming the specific
   file/selector, not just the rule code. Do not silently fix copy or markup
   without flagging — attorney-advertising pages (`disclaimer.html`,
   `attorney-advertising.html`) may need `lehr-law-copy-qa` review if fixing
   accessibility requires rewording visible text.

## When NOT to use

For general Lighthouse performance/SEO scoring, use `lighthouse-perf-audit`
instead — this skill is accessibility-only.
