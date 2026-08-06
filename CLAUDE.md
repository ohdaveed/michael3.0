# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Two independently deployed pieces live in this repo:

1. **The marketing site** — a static site for Michael Lehr Estate Planning (San Francisco). Plain HTML/CSS/JS compiled with Vite, no JS framework. Source lives under `public/`; `npm run build` compiles to `dist/`, which is uploaded to Bluehost over FTPS by GitHub Actions.
2. **`webhook-server/`** — a small Express service (its own `package.json`, `node >=20` — pino 10 pulls `thread-stream` 4, which requires it) that receives Tally contact-form submissions, Calendly booking events, and Microsoft Graph change notifications for the SharePoint "Client Pipeline" list. It is **not** part of the Vite build and does not ship with the site; it is deployed separately to Railway. See `webhook-server/README.md` for endpoints, env vars, and deploy steps.

They share a product taxonomy, but **not** a file: `public/js/product-contract.json` and `webhook-server/product-contract.json` are two byte-identical copies that must be edited together. The duplication is deliberate — Railway's root directory is `webhook-server/`, so the service cannot read anything above it. See [Cross-file contracts](#cross-file-contracts).

## Commands

See `package.json` for the full script list. The non-obvious ones:

- **`npm run check`** = `format:check` + `lint` (ESLint) + `html:check`. This is the static gate only, and what `.husky/pre-push` runs (alongside `npm run build`). CI runs more than this, so a green `check` is not a green PR — for the full CI-equivalent sequence run `npm run check && npm run test:e2e && npm run build`, plus the webhook-server tests below.
- **`npm run test:e2e`** starts its own dev server — `playwright.config.js` has a `webServer` block (`reuseExistingServer: !process.env.CI`), so you do _not_ need `npm run dev` running first.
- **`links:check`, `a11y:check`, `lighthouse`, `browser:check`** _do_ require `npm run dev` in another terminal — they hit `http://localhost:5173`, not the filesystem.
- **`webhook-server/` tests** run from that directory: `cd webhook-server && npm ci && npm test` (`node --test lib/*.test.js server.test.js`). The root `npm test` does not cover them.

Git hooks (husky, installed via the `prepare` script):

- `.husky/pre-commit` → `npx lint-staged` (Prettier on all staged files, htmlhint on staged `public/*.html` and `public/partials/*.html`).
- `.husky/pre-push` → `npm run check && npm run build`.

Prettier and htmlhint run on defaults plus the CLI flags in `package.json`. ESLint is configured in `eslint.config.mjs` (flat config; `.mjs` because the root `package.json` has no `"type": "module"`, so `export default` in a `.js` file would be parsed as CommonJS). It covers `public/js/`, `tests/e2e/`, and the two root config files, and ignores `webhook-server/`. `no-var` is deliberately off — four modules predate the ESM split. Partials are linted with a reduced htmlhint rule set because they are HTML fragments, not documents.

## Build pipeline (`vite.config.js`)

`root: "public"`, `build.outDir: "../dist"`, `emptyOutDir: true`. Four plugins run in order:

1. **`htmlIncludePlugin`** — replaces `<!--#include:partials/foo.html?KEY=value-->` with the partial's contents, substituting `{{KEY}}` from the query string, then the `GLOBAL_TOKENS` (currently just `{{BOOKING_URL}}`), then stripping any leftover `{{TOKEN}}` to `""`. Runs in dev _and_ build, so what you see at `localhost:5173` is what ships.
2. **`staticImagesPlugin`** — copies the files in `STATIC_IMAGES` straight into `dist/images/` under their original names. Vite rewrites image paths it can see in a tag attribute, emitting them hashed into `dist/assets/`; it cannot see a reference inside a partial, a JSON-LD string literal, or an absolute `og:image`/`twitter:image` URL, so nothing is emitted at `/images/<name>` for those. **The rule is about the reference, not the image: if an image is referenced anywhere by a path Vite does not rewrite, it needs a `STATIC_IMAGES` entry or that URL 404s in production.**

   Being used in a normal tag attribute somewhere else does not exempt it. `michael-lehr.webp` is exactly this case — `public/index.html` loads it with `src="images/michael-lehr.webp"` _and_ every page's `og:image`/`twitter:image` points at `https://www.lehr-law.com/images/michael-lehr.webp`. It correctly produces both outputs: a hashed `dist/assets/michael-lehr-<hash>.webp` for the tag, and `dist/images/michael-lehr.webp` for the absolute URL. Drop it from `STATIC_IMAGES` and the page still renders while every social and schema preview breaks.

3. **`ViteImageOptimizer`** — quality 80 for png/jpeg/webp, `multipass` for SVG.
4. **`seoFilesPlugin`** — generates `sitemap.xml`, `robots.txt`, and `llms.txt` into the build output.
   - Sitemap URLs keep their `.html` extension because Bluehost serves the pages only at those paths (no rewrites) and each page's canonical tag uses them. This is why `vite-plugin-sitemap` was replaced — it strips the extension, producing 404s that contradict the canonical tags.
   - `robots.txt` is `Allow: /` for all user-agents, which already covers AI crawlers (GPTBot, ClaudeBot, PerplexityBot). `llms.txt` (per [llmstxt.org](https://llmstxt.org)) gives those agents a curated Markdown summary; per-page entries are pulled from each built page's own `<title>` and `<meta name="description">` so they can't drift. Ordering comes from `LLMS_PAGE_ORDER` / `LLMS_OPTIONAL_PAGES`; a page in neither array is still appended automatically rather than silently dropped.
   - `thank-you.html` is excluded from both `sitemap.xml` and `llms.txt` (it is `noindex`).

### Adding a page

Two files, `public/<name>.html` and `vite.config.js`. Both required steps are:

1. Create `public/<name>.html` with the four includes (`head-analytics`, `nav.html?NAV_CLASS_ATTR=…`, `sticky-cta`, `footer`), a `<link rel="canonical">`, and OG tags on `SITE_URL`.
2. Register it in `build.rollupOptions.input` in `vite.config.js`. **This is the one that fails quietly — a page not listed there is never built**, even though it works fine in dev.

Then two further `vite.config.js` edits, neither of which is required and which apply in different cases:

- **Optional:** add it to `LLMS_PAGE_ORDER` or `LLMS_OPTIONAL_PAGES` to place it in `llms.txt`. Skipping this only affects ordering — an unlisted page is still appended.
- **Only if the page is `noindex`:** add it to the exclusion filter in `seoFilesPlugin` alongside `thank-you.html`.

## Site source conventions (`public/`)

- **`partials/`** — `nav.html`, `footer.html`, `sticky-cta.html`, `head-analytics.html`. Inlined at build time; all 11 pages include all four.
- **`css/styles.css`** is a pure `@import` manifest (44 imports) over `css/{base,components,sections,responsive}/`. The import order encodes the cascade from the original single-file stylesheet — append within the right group rather than reordering.
- **`js/main.js`** is an import-only aggregator; its order mirrors the original single-file execution order. Two modules are deliberately not imported there:
  - `js/hooks.js` — shared `useScroll`, `useIntersectionObserver`, `useAccordion`, imported by the feature modules. Reuse these instead of adding fresh scroll/observer listeners.
  - `js/booking-url.js` — the single source of truth for the Calendly consultation URL, imported directly by `vite.config.js`. HTML references it as `{{BOOKING_URL}}`. **Never hardcode the booking URL in a page.**
- **`js/analytics.js`** — GA4 custom events. Its header states the rule: send codes and locations only, never names, email addresses, phone numbers, message content, or booking/matter IDs. Keep new events to that standard.
- **GA4 measurement ID** lives only in `public/partials/head-analytics.html` (both the `gtag/js` src and the `gtag('config', ...)` call) — not read from env. One edit updates every page.
- **`public/.htaccess`** holds the HTTPS + `www` 301 redirect, HSTS/nosniff/frame/referrer headers, and cache-control rules. Note that **Vite does not copy it into `dist/`**, so it is not part of what the FTPS deploy uploads — it has to be maintained on the Bluehost server directly. Editing it locally has no effect on the live site until it is placed there by hand.

## Testing

- **`tests/e2e/`** — 11 Playwright specs (accessibility, analytics, faq, fixtures, funding-checklist, navigation, onboarding-tour, probate-calculator, quiz, send-a-message, sticky-cta) plus `tests/e2e/fixtures.js` helpers and a `fixtures/` directory. One `chromium` project, `baseURL http://localhost:5173`, trace on first retry, screenshots on failure. Under CI: `forbidOnly`, 2 retries, 2 workers.
  - `accessibility.spec.js` runs axe-core over the seven primary pages. It sets `reducedMotion` — without it the scroll reveal has axe sampling colours mid-transition, reporting blended values that never appear on screen and vary run to run. It disables `color-contrast` and `link-in-text-block`, whose only failures need a brand-palette decision rather than a code fix; the specific failures are documented in the spec. Every other rule is enforced.
- **`webhook-server/`** — Node's built-in test runner. Each module is colocated with its tests: `lib/<name>.js` + `lib/<name>.test.js` (graph-client, html, lead-ack, logger, mailer, pipeline-activity, pipeline-item-lock, pipeline-sync, product-contract, schemas, sharepoint, stage-engine, subscriptions), plus `server.test.js`. Follow that colocation when adding a module.

## CI/CD (`.github/workflows/`)

- **`ci.yml`** — on pull requests. Job `check`: `npm ci` → `npm run check` → install chromium → `npm run test:e2e` (uploads `playwright-report/` as an artifact on failure) → `npm run build`. Job `webhook-server`: `npm ci && npm test` inside `webhook-server/`. No deploy.
- **`deploy.yml`** — "Deploy to Bluehost". Runs on pushes to `main` that touch `public/**`, `vite.config.js`, `package.json`, or the workflow file itself, plus `workflow_dispatch`. Installs deps, runs `npm run check`, builds, then uploads `dist/` via `SamKirkland/FTP-Deploy-Action` over FTPS using an FTP-diff state file (`.ftp-deploy-sync-state.json`) kept server-side. Requires the `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` secrets (and optionally an `FTP_SERVER_DIR` repo variable if the FTP account's home directory isn't already the document root). If the optional `DEPLOY_WEBHOOK_URL` secret is set, success and failure each POST a JSON status payload to it.
- **`dolt-sync.yml`** — on pushes to `main`. Mirrors the commit log into DoltHub and appends it to a Google Sheet devlog via `.github/scripts/`. Independent of the site build.
- **`copilot-setup-steps.yml`** — dependency preinstall for GitHub Copilot agents.
- **`dependabot.yml`** — weekly npm updates for both `package.json` files, plus the Actions workflows.

## webhook-server conventions

- **Validation** — inbound Tally / Calendly / Graph payloads are parsed by the zod schemas in `lib/schemas.js`, which return `{ ok, data }` or `{ ok, error }` rather than throwing. Add fields there, not as inline checks in the handler. The schemas stay permissive about keys the handlers do not read: Tally and Calendly add fields on their own schedule, and rejecting an unrecognised one would break the integration.
- **Logging** — `lib/logger.js` exports a pino instance; handlers use `logger.child({ scope })` in place of the old `[tally]`-style prefixes. Its `redact` list is a privacy control, not formatting: client names, emails, phones, and message bodies must be logged under one of those key names so they are censored.

  **Never interpolate contact details into a log message string.** The redactor only sees structured keys, so anything embedded in the text sails straight through. This is why `syncPipelineSafely` takes the lead's email as a separate argument from its context label — the label is logged, the email is redacted, and the alert email to Michael still names the client.

- **HTML email** — everything interpolated into an email template is untrusted webhook input. Escape it with `escapeHtml` from `lib/html.js`, including values that land in an attribute (the `mailto:` href).
- **Graph calls** — `graphFetch` retries 429/503/504 honouring `Retry-After` with a capped exponential fallback, and attaches `err.status`. Branch on the status code rather than pattern-matching an error message.
- **Body parsing** — `express.json({ limit: "100kb", verify })` captures `req.rawBody` as a string for the Calendly HMAC. Keep it a string if that middleware is ever touched. Malformed JSON returns an explicit 400.
- **Rate limiting** — applied to `/webhooks` only. The health check at `/` must stay unlimited; Railway probes it continuously.

## Cross-file contracts

Things that break silently if only one side is changed:

- **Product taxonomy** — `public/js/product-contract.json` and `webhook-server/product-contract.json` are byte-identical and must stay so. The codes are stable keys that must never change meaning; the labels must match the Tally forms and the SharePoint choice column exactly. Any change requires bumping `contract_version` and updating `docs/client-pipeline.md` §3.
- **Canonical hostname** — canonical URLs, Open Graph tags, and JSON-LD in every page's `<head>` assume `https://www.lehr-law.com/`. If the deployed hostname changes, search-and-replace across every `public/*.html` **and** update `SITE_URL` in `vite.config.js` (which stamps `sitemap.xml`/`robots.txt`/`llms.txt`) — they must stay consistent with each other.
- **Booking URL** — `public/js/booking-url.js` only; surfaced in HTML via `{{BOOKING_URL}}`. `webhook-server` has its own optional `BOOKING_URL` env var for the acknowledgment email; keep it in sync if set.
- **Contact form** — `contact.html` embeds a Tally form (`tally.so/r/ob17lb`) inline via `js/tally-embed.js`, which fires the GA4 `generate_lead` event and redirects to `thank-you.html` (`noindex`, excluded from the sitemap) on submission. Hidden fields (`form_source`, `contract_version`, `page`) come from the embed URL's query string.

## Docs map

- `docs/client-pipeline.md` — the Microsoft 365 Client Pipeline build specification. Source of truth for the product contract, SharePoint list structure, Flows A–G, engagement gates, and the open decisions for Michael. Read the relevant section before touching webhook-server pipeline logic.
- `docs/webhooks.md` — external webhook and CI/CD notification setup (deploy notifications, Tally → Relay.app/Zapier/Clio, Slack).
- `docs/superpowers/plans/` and `docs/superpowers/specs/` — dated design and implementation docs for larger efforts. Check for an existing one before designing new webhook-server work.
- `docs/audit/`, `docs/hours/` (+ `scripts/hours/calculate_hours.py`) — a past multi-agent site audit and billable-hours reporting.
- `README.md` — human-facing setup: local dev, Tally/Calendly/GA4 configuration, Bluehost FTP one-time setup, launch checklist.

## Content/copy QA

For any content or copy edits to the marketing/legal pages, the `lehr-law-copy-qa` skill (`.claude/skills/lehr-law-copy-qa/SKILL.md`, mirrored at `.cursor/skills/lehr-law-copy-qa/SKILL.md`) defines this site's voice/tone rules, attorney-advertising constraints, and a review checklist (placeholders, link validity, cross-page consistency of phone/address/price/hours, HTML entity escaping). Read it before editing visible copy — it documents things like: don't add testimonials or `aggregateRating` schema without substantiation, keep results-page case studies anonymized, and get lawyer approval before substantive edits to the privacy/disclaimer/attorney-advertising trio.

## Agent skills

Six skills in `.claude/skills/`, each with a `SKILL.md`:

| Skill                     | Use when                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `lehr-law-copy-qa`        | Proofreading or writing visible copy on any page (see above).                                                                         |
| `seo-schema-check`        | After adding/renaming a page or changing the hostname — verifies canonical/OG/JSON-LD consistency against `sitemap.xml`/`robots.txt`. |
| `a11y-audit`              | Running pa11y against the dev server and turning violations into a fix list.                                                          |
| `lighthouse-perf-audit`   | Performance/SEO/Best-Practices auditing via Lighthouse against the dev server.                                                        |
| `image-asset-optimize`    | Before committing a new or changed file under `public/images/`.                                                                       |
| `ftp-deploy-troubleshoot` | A deploy failed, or changes aren't live on lehr-law.com.                                                                              |

### Issue tracker

GitHub Issues (`ohdaveed/michael3.0`). See `docs/agents/issue-tracker.md` for the conventions — note it is written against the `gh` CLI, which is **not available in Claude Code on the web**; use the GitHub MCP tools (`mcp__github__*`) there instead, applying the same conventions.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

`docs/agents/domain.md` describes a single-context setup with `CONTEXT.md` and `docs/adr/` at the repo root. **Neither currently exists**, which is expected — that doc says to proceed silently when they're absent rather than flagging or pre-creating them.
