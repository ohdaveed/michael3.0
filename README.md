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
