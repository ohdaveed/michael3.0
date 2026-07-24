# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static marketing site for Michael Lehr Estate Planning (San Francisco). Plain HTML/CSS/JS compiled with Vite (no JS framework). All source pages live under `public/`; `robots.txt`, `sitemap.xml`, and `llms.txt` are generated at build time by the `seoFilesPlugin` in `vite.config.js`. The build output compiles into `dist/` for production deployment.

## Commands

See `package.json` scripts for available npm commands.

`links:check`, `a11y:check`, `lighthouse`, and `browser:check` all require `npm run dev` running in another terminal first — they hit `http://localhost:5173`, not the filesystem.

There is no test suite; `npm run check` (formatting + HTML lint) is the closest thing to CI-equivalent validation before a push.

## Architecture

- `public/` — source files actually served: the HTML pages, `partials/` (nav, footer, sticky CTA, GA snippet — inlined at build time via the `htmlIncludePlugin` in `vite.config.js`), `css/styles.css` (an `@import` manifest over `css/{base,components,sections,responsive}/`), `js/main.js` (an aggregator importing the per-feature modules in `js/`), `images/`.
- `dist/` — the compiled output from `npm run build`. This is the deploy unit. The build also generates `sitemap.xml`, `robots.txt`, and `llms.txt` (see `seoFilesPlugin` in `vite.config.js`); sitemap URLs keep their `.html` extension because Bluehost serves the pages only at those paths and each page's canonical tag uses them. `robots.txt` allows all user-agents (`Allow: /`), which already covers AI crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.) — `llms.txt` (per the [llmstxt.org](https://llmstxt.org) convention) gives those agents a curated Markdown summary of the site; its per-page entries are pulled from each page's own `<title>`/`<meta name="description">` at build time so they can't drift, per `LLMS_PAGE_ORDER`/`LLMS_OPTIONAL_PAGES` in `vite.config.js`. A newly added page not listed in either array still gets appended automatically rather than silently dropped.
- `.github/workflows/deploy.yml` — the GitHub Actions FTPS deploy workflow (active). Deploys on every push to `main` that touches `public/`, `vite.config.js`, `package.json`, or the workflow file itself. The action installs dependencies, runs `npm run check`, runs the Vite build to compile assets into `dist/`, and uploads `dist/` to Bluehost using an FTP-diff state file (`.ftp-deploy-sync-state.json`) kept server-side. Requires the `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` repo secrets (and optionally an `FTP_SERVER_DIR` repo variable if the FTP account's home directory isn't already the site's document root). `.github/workflows/ci.yml` runs the same check + build on pull requests without deploying.
- Canonical URLs, Open Graph tags, and JSON-LD schema in each HTML page's `<head>` assume the live site is `https://www.lehr-law.com/`. If the deployed hostname changes, that base URL needs a search-and-replace across every `public/*.html` plus `SITE_URL` in `vite.config.js` (which stamps the generated `sitemap.xml`/`robots.txt`) — they must stay consistent with each other.
- Contact form (`contact.html`) is a Tally form (`tally.so/r/ob17lb`) embedded inline via `js/tally-embed.js`, which also fires the GA4 `generate_lead` event and redirects to `thank-you.html` (`noindex`, excluded from `sitemap.xml`) on submission. Hidden fields (`form_source`, `contract_version`, `page`) come from the embed URL's query string; the product taxonomy contract lives in `js/product-contract.json` and `docs/client-pipeline.md` §3.
- GA4 tracking ID lives only in `public/partials/head-analytics.html` (`gtag/js` script src + `gtag('config', ...)`), which every page pulls in via the `<!--#include:...-->` mechanism — not read from env.

## Content/copy QA

For any content or copy edits to the marketing/legal pages, the `.cursor/skills/lehr-law-copy-qa/SKILL.md` skill defines this site's voice/tone rules, attorney-advertising constraints, and a review checklist (placeholders, link validity, cross-page consistency of phone/address/price/hours, HTML entity escaping). Read it before editing visible copy — it documents things like: don't add testimonials or `aggregateRating` schema without substantiation, keep results-page case studies anonymized, and get lawyer approval before substantive edits to the privacy/disclaimer/attorney-advertising trio.

## Agent skills

### Issue tracker

GitHub Issues (`ohdaveed/michael3.0`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
