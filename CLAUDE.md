# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static marketing site for Michael Lehr Estate Planning (San Francisco). Plain HTML/CSS/JS — no build step, no framework, no bundler. All content that gets deployed lives under `public/`; `robots.txt` and `sitemap.xml` are deployed from the repo root alongside it.

## Commands

```bash
npm install
npm run dev            # serve site at http://localhost:5173 (alias: npm run serve)
npm run format          # prettier --write over *.{html,css,js,json,md} and docs/**
npm run format:check    # prettier --check (same scope)
npm run html:check      # htmlhint over *.html (note: repo-root only, not public/)
npm run links:check     # linkinator crawl of the running local server
npm run a11y:check      # pa11y against the running local server
npm run lighthouse      # lighthouse report against the running local server -> lighthouse-report.html
npm run browser:check   # agent-browser open/snapshot against the running local server
npm run check           # format:check + html:check
```

`links:check`, `a11y:check`, `lighthouse`, and `browser:check` all require `npm run dev` running in another terminal first — they hit `http://localhost:5173`, not the filesystem.

There is no test suite; `npm run check` (formatting + HTML lint) is the closest thing to CI-equivalent validation before a push.

## Architecture

- `public/` — everything actually served: the HTML pages, `css/styles.css`, `js/main.js`, `images/`. This is the deploy unit.
- `robots.txt`, `sitemap.xml` — deployed from repo root, not `public/`.
- `.github/workflows/deploy.yml` — the GitHub Actions FTPS deploy workflow (active). Deploys on every push to `main` that touches `public/`, `robots.txt`, `sitemap.xml`, or the workflow file itself, using an FTP-diff state file (`.ftp-deploy-sync-state.json`) kept server-side. Requires the `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` repo secrets (and optionally an `FTP_SERVER_DIR` repo variable if the FTP account's home directory isn't already the site's document root).
- `js/main.js` (shared across pages) — nav, mobile menu, FAQ accordion, smooth scroll, contact form submit/redirect handling.
- Canonical URLs, Open Graph tags, and JSON-LD schema in each HTML page's `<head>` assume the live site is `https://www.lehr-law.com/`. If the deployed hostname changes, that base URL needs a search-and-replace across every `public/*.html`, `sitemap.xml`, and `robots.txt` — they must stay consistent with each other.
- Contact form (`contact.html`) posts to Web3Forms using an access key embedded in a hidden input; the key is scoped/restricted to the production domain in the Web3Forms dashboard rather than kept secret. `main.js` handles the post-submit redirect to `thank-you.html` (which is `noindex` and excluded from `sitemap.xml`).
- GA4 tracking ID is hardcoded in `index.html` (`gtag/js` script src + `gtag('config', ...)`) — not templated or read from env.

## Content/copy QA

For any content or copy edits to the marketing/legal pages, the `.cursor/skills/lehr-law-copy-qa/SKILL.md` skill defines this site's voice/tone rules, attorney-advertising constraints, and a review checklist (placeholders, link validity, cross-page consistency of phone/address/price/hours, HTML entity escaping). Read it before editing visible copy — it documents things like: don't add testimonials or `aggregateRating` schema without substantiation, keep results-page case studies anonymized, and get lawyer approval before substantive edits to the privacy/disclaimer/attorney-advertising trio.
