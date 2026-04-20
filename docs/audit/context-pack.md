# Subagent context pack — Michael Lehr (lehr-law) static site audit

Workspace root: `c:\Users\david\source\repos\michael2.0`

## Files in scope

Marketing: `index.html`, `services.html`, `process.html`, `faq.html`, `results.html`, `contact.html`, `thank-you.html`  
Legal notices: `privacy-policy.html`, `disclaimer.html`, `attorney-advertising.html`  
Assets: `styles.css`, `main.js`

## Copy and advertising rules (from `.cursor/skills/lehr-law-copy-qa/SKILL.md`)

- Voice: professional, calm, **you** where appropriate; prefer **Michael** over vague **we** when it blurs who does the work.
- San Francisco in body; SF only where space is tight.
- No outcome guarantees; past results illustrative; avoid absolutes unless qualified.
- Pricing: "starting at" / "consultation required" for variable work.
- Checklist: placeholders, real links (no EXAMPLE), cross-page consistency (phone, address, email, price, reviews, hours), scannability, CTA language, `&amp;` in HTML text.
- JSON-LD in `index.html` must match visible claims (`openingHours`, etc.). No on-site review aggregates unless published and substantiated.
- Do not propose substantive edits to privacy/disclaimer/attorney-advertising without lawyer sign-off (flag only).

## Agent output templates

**Agent 1 (Copy/Legal):** (1) Short summary. (2) Must fix / Should fix / Nice to have. (3) Concrete replacement sentences. (4) Flags: unverifiable claims, statutory refresh, schema mismatch.

**Agent 2 (UX/Persuasion):** Rubric scores 1–5 for: clarity of outcome, you-language/trust vs hype, CTA discipline, objection handling, social proof. CTA map. 5–10 prioritized persuasive upgrades with user benefit.

**Agent 3 (Tech/SEO/A11y):** Table: location (file + selector or line), severity, issue, suggested fix.

**Agent 4 (Benchmark):** Pattern memo (1–2 pages equivalent) + 10 "apply this pattern" ideas with risk notes. No copied prose from comparators. Estate-only positioning: site does not list family law as a practice.

## Firm facts (for consistency checks)

- Address: 645 Hayes Street, San Francisco, CA 94102  
- Email: <michael@lehr-law.com>  
- Canonical domain: <https://www.lehr-law.com>  
- Living trust package copy references starting at $2,495  
- Schema: opening hours 09:00–20:00 all days in JSON-LD (verify against actual practice policy)
