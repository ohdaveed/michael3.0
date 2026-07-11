---
name: lehr-law-copy-qa
description: Proofreads and suggests copy for the Michael Lehr estate planning static site (HTML). Use when the user asks to proofread the site, improve web copy, check attorney advertising tone, fix placeholders, align San Francisco naming, or review marketing language across lehr-law pages.
---

# Lehr Law site copy QA

## Scope

All public marketing and legal notice HTML, under `public/`:

- `public/index.html`, `public/services.html`, `public/process.html`, `public/faq.html`, `public/results.html`, `public/contact.html`
- `public/privacy-policy.html`, `public/disclaimer.html`, `public/attorney-advertising.html`

Also check JSON-LD in `public/index.html` (`openingHours`, etc.) for consistency with visible claims. (Do not add `aggregateRating` or on-site client testimonials unless the firm publishes and substantiates them.)

## Voice and tone

- Professional, calm, direct; address the reader as **you** where appropriate.
- Prefer **plain language** for services and process; legal pages stay formal but readable.
- Emphasize **Michael** as the primary attorney; avoid anonymous **we** where it blurs who does the work (use **the firm** or **Michael** intentionally).
- **San Francisco** in body copy and headings; **SF** only where space is tight (e.g. small labels) if already established.

## Attorney advertising and risk

- Do not promise outcomes; past results and case studies stay **illustrative** (align with disclaimer and attorney-advertising pages). The public site does not use client testimonials unless the owner adds them later.
- Avoid absolute claims ("always," "guarantee," "never") unless legally accurate and qualified.
- Pricing: keep **starting at** / **consultation required** language where complexity varies.
- Statutory probate numbers: treat as **general California references**; flag if amounts or thresholds need a legal refresh.

## Checklist (run on each pass)

1. **Placeholders** — No "coming soon," "placeholder," "EXAMPLE," or dev-only map/video copy visible to visitors without a clear client-facing alternative.
2. **Links** — Third-party review/profile URLs must be real; no `EXAMPLE` paths. Until URLs exist, use a documented interim (e.g. Maps search by firm name + address) or remove the link and keep plain text.
3. **Consistency** — Phone, address, email, package price, and hours match across pages, footer, and schema. If ratings or reviews are ever added to the site or schema, they must match substantiated, visible content.
4. **Scannability** — Headings describe content; long credential lines belong on bio/advertising pages if they hurt the homepage.
5. **Accessibility of language** — Button and CTA text stay action-oriented; FAQ answers stay concise.
6. **HTML hygiene** — `&` in text/titles escaped as `&amp;` where required.

## Output format

When asked for a review only:

1. Short summary (tone, strengths).
2. **Issues** grouped: Must fix / Should fix / Nice to have.
3. Concrete **suggested replacement sentences** (not vague "consider shortening").

When asked to edit files:

- Prefer minimal diffs; preserve HTML structure and classes.
- Do not change Web3Forms keys or tracking IDs unless the user asks.

## Inventory notes (maintenance)

- **results.html** — Case studies are anonymized; keep that framing. Do not add testimonial or third-party review blocks without owner approval and substantiation.
- **contact.html** — Keep visitor-safe wording; the unfinished map placeholder was removed (see commit 579d048) — no map section currently exists, so don't reintroduce placeholder text if adding one back.
- **Legal trio** — Privacy, disclaimer, attorney advertising are template-heavy; substantive legal edits need lawyer approval.
