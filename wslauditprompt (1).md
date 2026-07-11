We have an existing site audit at docs/audit/2026-04-19-multi-agent-site-audit.md for this repo (ohdaveed/michael3.0, the Michael Lehr estate-planning site). All P0 (testimonial/schema/legal) items are already resolved — don't touch those. I want you to work through the remaining P1 backlog now, then P2 if time allows. Read the full audit doc first for context, then implement:

## P1 — do these

1. **P1-7 (CSS, do this first — it affects rendering sitewide):** `--font-display` is referenced across pages but never defined in `:root` in `public/css/styles.css`, and `--serif`/`--sans` still reference Cormorant/Outfit even though the HTML actually loads Fraunces + Lexend (Google Fonts link in `<head>`). Define `--font-display` and align `--serif`/`--sans` to the fonts actually loaded, or replace the inline uses — whichever is the smaller diff.
2. **P1-6 (a11y):** FAQ accordion in `public/faq.html` / `public/js/main.js` lacks stable panel `id`s, `aria-controls` on the trigger, and `hidden` on collapsed panels. Wire these up properly.
3. **P1-1 (copy):** Absolute "always" language in `index.html` (pricing section) and `process.html` (hero, lifetime support) reads as an overpromise. Soften to something accurate but still confident.
4. **P1-2 (copy):** Anonymous "we"/"us" on home, contact, FAQ, services should mostly become "Michael" or "the firm" — this is a solo practice, and the audit flags the voice mismatch. Do a pass across those pages.
5. **P1-3 (copy):** FAQ line "We mediate options" implies formal professional mediation — rephrase to neutral facilitation language.
6. **P1-4 (copy, flag for human review, don't just ship):** FAQ has a blanket claim "Formal probate needs a lawyer in California" — this needs qualifying language; flag it clearly in your summary since it may need attorney sign-off rather than a confident rewrite.
7. **P1-5 (HTML bug):** `process.html` has a raw `&` in a visible H3 ("Draft & Review") instead of `&amp;` — fix the entity encoding.
8. **P1-8 (IA):** `index.html` has `id="contact"` on a CTA band that is NOT the actual contact form (the real form lives at `contact.html#contact`). Rename the fragment id or add a clarifying heading so it's not misleading/colliding.
9. **P1-9 (content):** Homepage video block still says "Video Coming Soon" — replace with short copy for now (no real video to embed yet).
10. **P1-10 (analytics):** GA4 snippet is only on `index.html`. If sitewide metrics matter, add the same snippet to all other public pages.

## P2 — nice to have, do if P1 is clean and you have room

- P2-1: No `og:image`/Twitter card sitewide
- P2-2: `privacy-policy.html` meta description vs `og:description` mismatch
- P2-3: Heading skips (h1 → h3 on process/results; footer h4 after main h2)
- P2-4: Thank-you page should orient on wait time + link to `process.html` instead of just bouncing back to an empty form
- P2-5: Contact page's bottom CTA duplicates a same-page anchor — swap for "what happens after you send"
- P2-6: Sticky CTA only appears after ~80% scroll (`main.js`) — consider an earlier threshold on mobile
- P2-7: Missing `autocomplete` on contact form fields; missing `aria-hidden` on decorative SVGs
- P2-9: Lexend font weight payload could be subset/trimmed

Skip P2-8 (mobile nav `inert`/scroll lock) and P2-10/P2-11 (copy polish, statutory numbers) unless you have extra time — lower leverage.

## Process

- Work file by file, keep diffs tight — this is a "fix what's flagged," not a refactor.
- Do NOT reintroduce testimonials, ratings, or `aggregateRating` schema — the owner explicitly opted out (see the audit's revision note at the top).
- After each logical group of changes, run whatever lint/check scripts exist in `package.json` (`npm run check` at minimum).
- Once everything's done and checked, deploy to the live site to verify visually. Use `scripts/deploy.sh` (rsync/SSH — already fixed to force correct permissions via `--chmod=D755,F644`, so it's safe to run) rather than plain FTP if it's available in your PATH — it's more reliable than raw ftp put commands. If you only have FTP access and not rsync, mirror what `scripts/deploy.sh` does: upload the contents of `public/` plus `robots.txt`/`sitemap.xml` to the site's actual document root on Bluehost, and make sure uploaded files land as 644 (files) / 755 (directories) — a prior deploy took the live site down with a 403 by uploading files at 600/700 permissions, so this is not optional.
- After deploying, load www.lehr-law.com and click through home, FAQ (test the accordion), process, contact, and results to confirm nothing broke.
- Commit your changes with clear messages as you go (don't batch everything into one giant commit), then push to a branch and note that a PR should be opened for review before/after deploy — don't just deploy silently without a corresponding commit trail.
- Give me a final summary: what shipped, what you flagged for human/attorney review (especially P1-4), and what you skipped and why.
