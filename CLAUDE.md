# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static marketing site for Michael Lehr Estate Planning (San Francisco). Plain HTML/CSS/JS compiled with Vite (no JS framework). All source pages live under `public/`; `robots.txt` and `sitemap.xml` are generated at build time by `vite-plugin-sitemap` (see `vite.config.js`), not copied from the repo root. The build output compiles into `dist/` for production deployment.

## Commands

See `package.json` scripts for available npm commands.

`links:check`, `a11y:check`, `lighthouse`, and `browser:check` all require `npm run dev` running in another terminal first — they hit `http://localhost:5173`, not the filesystem.

There is no test suite; `npm run check` (formatting + HTML lint) is the closest thing to CI-equivalent validation before a push.

## Architecture

- `public/` — source files actually served: the HTML pages, `css/styles.css`, `js/main.js`, `images/`.
- `dist/` — the compiled output from `npm run build`. This is the deploy unit.
- `robots.txt`, `sitemap.xml` — generated into `dist/` at build time by the `vite-plugin-sitemap` plugin configured in `vite.config.js` (routes are derived from the Rollup HTML inputs, then a small custom plugin patches `.html` back onto each URL since `vite-plugin-sitemap` strips extensions by default and the site has no rewrite rule for extensionless paths). Stale root-level `robots.txt.backup`/`sitemap.xml.backup` files predate this and aren't used by the build or the deploy workflow.
- `.github/workflows/deploy.yml` — the GitHub Actions FTPS deploy workflow (active). Deploys on every push to `main` that touches `public/`, `vite.config.js`, `package.json`, or the workflow file itself. The action installs dependencies, runs the Vite build to compile assets (including `robots.txt`/`sitemap.xml`) into `dist/`, and uploads `dist/` to Bluehost using an FTP-diff state file (`.ftp-deploy-sync-state.json`) kept server-side. Requires the `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` repo secrets (and optionally an `FTP_SERVER_DIR` repo variable if the FTP account's home directory isn't already the site's document root).
- `js/main.js` (shared across pages) — nav, mobile menu, FAQ accordion, smooth scroll, contact form submit/redirect handling.
- Canonical URLs, Open Graph tags, and JSON-LD schema in each HTML page's `<head>` assume the live site is `https://www.lehr-law.com/`. If the deployed hostname changes, that base URL needs a search-and-replace across every `public/*.html`, `sitemap.xml`, and `robots.txt` — they must stay consistent with each other.
- Contact form (`contact.html`) posts to Web3Forms using an access key embedded in a hidden input; the key is scoped/restricted to the production domain in the Web3Forms dashboard rather than kept secret. `main.js` handles the post-submit redirect to `thank-you.html` (which is `noindex` and excluded from `sitemap.xml`).
- GA4 tracking ID is hardcoded in `index.html` (`gtag/js` script src + `gtag('config', ...)`) — not templated or read from env.

## Content/copy QA

For any content or copy edits to the marketing/legal pages, the `.cursor/skills/lehr-law-copy-qa/SKILL.md` skill defines this site's voice/tone rules, attorney-advertising constraints, and a review checklist (placeholders, link validity, cross-page consistency of phone/address/price/hours, HTML entity escaping). Read it before editing visible copy — it documents things like: don't add testimonials or `aggregateRating` schema without substantiation, keep results-page case studies anonymized, and get lawyer approval before substantive edits to the privacy/disclaimer/attorney-advertising trio.
