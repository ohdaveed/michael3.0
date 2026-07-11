# Michael Lehr Estate Planning Website — Setup Instructions

## Overview

Static site with schema markup, Google Analytics 4, Web3Forms contact form, legal pages, FAQ, and shared behavior in `main.js`.

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

- `npm run dev` — run a local development server
- `npm run serve` — same as `dev`

## Required setup steps

### 1. Contact form (Web3Forms)

1. Create a form at <https://web3forms.com/> and copy the access key.
2. In `contact.html`, find the hidden input `name="access_key"` and set its `value` to your key.
3. In the Web3Forms dashboard, restrict the key to your production domain (the key is visible in HTML).
4. After a successful submit, visitors are sent to `thank-you.html` (see `main.js`). The hidden `redirect` field must use your live site URL; update it in `contact.html` if your canonical domain is not `https://www.lehr-law.com/`.

### 2. Google Analytics 4

1. Create a GA4 property and copy the measurement ID (`G-XXXXXXXXXX`).
2. In `index.html`, replace `G-9PV0J0XLVC` in both the `gtag/js` script `src` and the `gtag('config', ...)` call.

### 3. Schema and content

1. In `index.html`, update the JSON-LD block in `<head>`: real site URL, image URL, coordinates, and any ratings only if you can verify them.
2. Review credentials in the About section (`#about`) for accuracy (bar number, education, etc.).

### 4. Optional: photo and video

1. **Photo:** Add an `<img>` inside `.about-image-frame` in `index.html` (About section).
2. **Video:** Replace the `.video-placeholder` block in `index.html` with your embed when ready.

### 5. SSL

Serve the site over HTTPS so the contact form and third-party scripts behave as expected.

### 6. Canonical domain, sitemap, and robots

Every public HTML page includes a `link rel="canonical"` and Open Graph tags that assume the live site is served at `https://www.lehr-law.com/` (same host as the Web3Forms redirect note above). If you use a different hostname (for example bare `lehr-law.com` without `www`), search-and-replace that base URL in all `.html` files, in `sitemap.xml`, and in `robots.txt` so they stay consistent.

- `robots.txt` — allows crawlers and points to the sitemap.
- `sitemap.xml` — lists indexable pages (excluding `thank-you.html`, which stays `noindex`).

## Deployment (auto-deploy to Bluehost)

Every push to `main` that touches `public/`, `robots.txt`, or `sitemap.xml` triggers `.github/workflows/deploy.yml`, which uploads the contents of `public/` plus `robots.txt` and `sitemap.xml` to Bluehost over FTPS. Only changed files are transferred (the action keeps a state file, `.ftp-deploy-sync-state.json`, on the server to track this).

### One-time setup

1. **Activate the workflow** — the workflow file ships as `.github/workflows-pending/deploy.yml` because automated pushes can't write to `.github/workflows/` without the `workflow` OAuth scope. Move it into place: on GitHub, open the file, click the pencil (edit), change the path from `workflows-pending` to `workflows`, and commit — or locally, `git mv .github/workflows-pending/deploy.yml .github/workflows/deploy.yml` and push.
2. **Create a deploy-only FTP account in Bluehost** — cPanel → Files → FTP Accounts. Set its home **Directory** to the document root that serves `www.lehr-law.com` (usually `public_html`, or the addon-domain folder). Scoping the account to that folder means the credentials stored in GitHub can't touch anything else on the hosting account.
3. **Add GitHub Actions secrets** — repo → Settings → Secrets and variables → Actions → New repository secret:
   - `FTP_SERVER` — the FTP hostname from cPanel (e.g. `ftp.lehr-law.com` or the `*.bluehost.com` server name)
   - `FTP_USERNAME` — the FTP account you created (e.g. `deploy@lehr-law.com`)
   - `FTP_PASSWORD` — that account's password
4. **(Only if not using a scoped account)** If you use the main cPanel login instead, add a repository **variable** `FTP_SERVER_DIR` set to the document root path (e.g. `public_html/`, trailing slash required).
5. **Test it** — repo → Actions → "Deploy to Bluehost" → Run workflow. The first run uploads everything; later runs upload only diffs.

### Alternative: manual deploy over SSH/rsync

If SSH access to Bluehost is set up (see cPanel → Security → SSH Access) and you'd rather deploy on demand from your own machine instead of via GitHub Actions, use `scripts/deploy.sh`:

```bash
./scripts/deploy.sh              # upload changed/new files
./scripts/deploy.sh --dry-run    # preview what would change, no upload
```

It stages `public/` plus `robots.txt` and `sitemap.xml` and `rsync`s them to the server over SSH. It does not delete remote files by default — pass `--delete` (with confirmation) only if you're sure `BLUEHOST_DIR` points at the exact document root and nothing else lives there. Configure the target via environment variables (`BLUEHOST_USER`, `BLUEHOST_HOST`, `BLUEHOST_PORT`, `BLUEHOST_DIR`); see the comments at the top of the script for defaults and details. This path and the GitHub Actions workflow above are independent — use whichever fits your workflow, or both.

## File structure

```text
michael2.0/
├── index.html                 # Home
├── contact.html               # Contact form + Web3Forms key
├── thank-you.html             # Post-submit confirmation (noindex)
├── services.html, faq.html, results.html, process.html
├── privacy-policy.html, disclaimer.html, attorney-advertising.html
├── robots.txt                 # Crawl rules + sitemap URL
├── sitemap.xml                # Indexable URLs for search engines
├── styles.css
└── main.js                    # Animations, nav, FAQ, form submit
```

## Testing checklist (before launch)

- [ ] Submit the contact form end-to-end.
- [ ] Click every nav and footer link (including legal pages and deep links under Services).
- [ ] Mobile menu and Escape to close on marketing and legal pages; FAQ accordion on `faq.html`.
- [ ] Smooth scroll from in-page `#` links where used.
- [ ] GA receives events (optional: GA Debugger).

## References

- Web3Forms: <https://docs.web3forms.com/>
- Google Analytics: <https://support.google.com/analytics>
- Schema.org Attorney: <https://schema.org/Attorney>
