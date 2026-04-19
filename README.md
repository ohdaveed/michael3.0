# Michael Lehr Estate Planning Website — Setup Instructions

## Overview

Static site with schema markup, Google Analytics 4, Web3Forms contact form, legal pages, FAQ, and shared behavior in `main.js`.

## Required setup steps

### 1. Contact form (Web3Forms)

1. Create a form at https://web3forms.com/ and copy the access key.
2. In `contact.html`, find the hidden input `name="access_key"` and set its `value` to your key.
3. In the Web3Forms dashboard, restrict the key to your production domain (the key is visible in HTML).

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

## File structure

```
michael2.0/
├── index.html                 # Home
├── contact.html               # Contact form + Web3Forms key
├── services.html, faq.html, results.html, process.html
├── privacy-policy.html, disclaimer.html, attorney-advertising.html
├── styles.css
└── main.js                    # Animations, nav, FAQ, form submit
```

## Testing checklist (before launch)

- [ ] Submit the contact form end-to-end.
- [ ] Click every nav and footer link (including legal pages returning to `index.html`).
- [ ] Mobile menu, Escape to close, FAQ accordion on `faq.html`.
- [ ] Smooth scroll from in-page `#` links where used.
- [ ] GA receives events (optional: GA Debugger).

## References

- Web3Forms: https://docs.web3forms.com/
- Google Analytics: https://support.google.com/analytics
- Schema.org Attorney: https://schema.org/Attorney
