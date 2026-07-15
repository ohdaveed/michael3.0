# Michael Lehr Estate Planning Website — Setup Instructions

## Overview

Static marketing site (plain HTML/CSS/JS, no framework) built with Vite. Includes schema markup, Google Analytics 4, a Tally contact form with Calendly booking, legal pages, and an FAQ. Source pages live in `public/`; `npm run build` compiles everything into `dist/`, which is what gets deployed.

## Local development

### Prerequisites

- Node.js 18+ (recommended)

### Run locally

```bash
npm install
npm run dev
```

This serves the site at `http://localhost:5173`.

### Available scripts

- `npm run dev` / `npm run serve` — run a local development server
- `npm run build` — compile the site into `dist/` (also generates `sitemap.xml` and `robots.txt`)
- `npm run check` — Prettier formatting check + htmlhint on all pages (run in CI and by the pre-push hook)
- `npm run format` — apply Prettier formatting
- `npm run links:check` / `a11y:check` / `lighthouse` / `browser:check` — quality audits; each needs `npm run dev` running in another terminal first

## Required setup steps

### 1. Contact form (Tally) and booking (Calendly)

1. The contact form is a [Tally](https://tally.so/) form embedded inline on `contact.html` via `js/tally-embed.js`. To point at a different form, change the `data-tally-src` URL (and the `noscript` fallback link) in `contact.html`.
2. On submit, `js/tally-embed.js` fires the GA4 `generate_lead` event and redirects to `thank-you.html`. Hidden fields (`form_source`, `contract_version`, `page`) come from the embed URL's query string; the intake taxonomy is documented in `js/product-contract.json` and `docs/client-pipeline.md`.
3. The consultation booking URL (Calendly) has a single source of truth: `public/js/booking-url.js`. HTML uses the `{{BOOKING_URL}}` token, substituted at build time.

### 2. Google Analytics 4

1. Create a GA4 property and copy the measurement ID (`G-XXXXXXXXXX`).
2. Replace `G-9PV0J0XLVC` in `public/partials/head-analytics.html` (the snippet is injected into every page at build time — one edit updates the whole site).

### 3. Schema and content

1. In `index.html`, update the JSON-LD block in `<head>`: real site URL, image URL, coordinates, and any ratings only if you can verify them.
2. Review credentials in the About section (`#about`) for accuracy (bar number, education, etc.).

### 4. Optional: photo and video

1. **Photo:** Add an `<img>` inside `.about-image-frame` in `index.html` (About section).
2. **Video:** Replace the `.video-placeholder` block in `index.html` with your embed when ready.

### 5. SSL

Serve the site over HTTPS so the contact form and third-party scripts behave as expected.

### 6. Canonical domain, sitemap, and robots

Every public HTML page includes a `link rel="canonical"` and Open Graph tags that assume the live site is served at `https://www.lehr-law.com/`. `sitemap.xml` and `robots.txt` are generated at build time by the `seoFilesPlugin` in `vite.config.js`, using the same base URL (`SITE_URL`). If you use a different hostname (for example bare `lehr-law.com` without `www`), search-and-replace the base URL in all `public/*.html` files **and** update `SITE_URL` in `vite.config.js` so they stay consistent.

- `robots.txt` — allows crawlers and points to the sitemap.
- `sitemap.xml` — lists indexable pages with their real `.html` URLs (excluding `thank-you.html`, which stays `noindex`).

## Deployment (auto-deploy to Bluehost)

Every push to `main` that touches `public/`, `vite.config.js`, `package.json`, or the workflow file triggers `.github/workflows/deploy.yml`, which installs dependencies, runs `npm run check`, builds the site with Vite, and uploads `dist/` to Bluehost over FTPS. Only changed files are transferred (the action keeps a state file, `.ftp-deploy-sync-state.json`, on the server to track this). Pull requests run the same checks via `.github/workflows/ci.yml` without deploying.

### One-time setup

1. **Create a deploy-only FTP account in Bluehost** — cPanel → Files → FTP Accounts. Set its home **Directory** to the document root that serves `www.lehr-law.com` (usually `public_html`, or the addon-domain folder). Scoping the account to that folder means the credentials stored in GitHub can't touch anything else on the hosting account.
2. **Add GitHub Actions secrets** — repo → Settings → Secrets and variables → Actions → New repository secret:
   - `FTP_SERVER` — the FTP hostname from cPanel (e.g. `ftp.lehr-law.com` or the `*.bluehost.com` server name)
   - `FTP_USERNAME` — the FTP account you created (e.g. `deploy@lehr-law.com`)
   - `FTP_PASSWORD` — that account's password
3. **(Only if not using a scoped account)** If you use the main cPanel login instead, add a repository **variable** `FTP_SERVER_DIR` set to the document root path (e.g. `public_html/`, trailing slash required).
4. **Test it** — repo → Actions → "Deploy to Bluehost" → Run workflow. The first run uploads everything; later runs upload only diffs.

## File structure

```text
michael3.0/
├── public/                    # Source files served by Vite
│   ├── index.html             # Home
│   ├── contact.html           # Tally contact form embed
│   ├── thank-you.html         # Post-submit confirmation (noindex)
│   ├── services.html, faq.html, results.html, process.html, what-to-expect.html
│   ├── privacy-policy.html, disclaimer.html, attorney-advertising.html
│   ├── partials/              # nav, footer, sticky CTA, GA snippet (inlined at build)
│   ├── css/                   # styles.css manifest + base/components/sections/responsive
│   ├── js/                    # main.js imports per-feature modules (nav, FAQ, quiz, …)
│   └── images/
├── vite.config.js             # Build config: HTML includes, image optimization, sitemap/robots
├── dist/                      # Build output (deployed; not committed)
└── .github/workflows/         # ci.yml (PR checks) + deploy.yml (build & FTPS upload)
```

## Testing checklist (before launch)

- [ ] Submit the contact form end-to-end (Tally embed loads, submit redirects to `thank-you.html`).
- [ ] Click every nav and footer link (including legal pages and deep links under Services).
- [ ] Mobile menu and Escape to close on marketing and legal pages; FAQ accordion on `faq.html`.
- [ ] Smooth scroll from in-page `#` links where used.
- [ ] GA receives events (optional: GA Debugger).

## References

- Tally: <https://tally.so/help>
- Calendly: <https://help.calendly.com/>
- Google Analytics: <https://support.google.com/analytics>
- Schema.org Attorney: <https://schema.org/Attorney>
