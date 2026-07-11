# Multi-agent site audit — Michael Lehr (lehr-law.com)

Date: 2026-04-19  
Method: Four parallel specialist passes (copy/legal, UX/persuasion, tech/SEO/accessibility, external benchmark patterns) plus this integrator synthesis. Context pack: [context-pack.md](context-pack.md).  
This document is **not legal advice**; compliance items need California counsel review where noted.

**Revision (same day):** Per owner direction, **client testimonials are not used** on the public site. The following were implemented: removed `aggregateRating` from `index.html` JSON-LD; updated `results.html` title/meta/OG to case-study-only copy and **deleted** the commented testimonials/reviews HTML block; revised `disclaimer.html` and `attorney-advertising.html` to remove on-site testimonial sections and align prior-results language with **case studies only**; removed unused testimonial/review CSS from `styles.css`; refreshed [lehr-law-copy-qa](../../.cursor/skills/lehr-law-copy-qa/SKILL.md) and [context-pack.md](context-pack.md). **Counsel should still review** the edited disclaimer and attorney-advertising paragraphs.

---

## Executive summary

The site is visually cohesive, with strong **pricing transparency**, **plain-language education** (FAQ, services, probate snapshot), and **illustrative case framing** on Results. The former **P0 testimonial and ratings mismatch** (JSON-LD reviews without visible substantiation, meta promising testimonials, legal pages describing on-site testimonials) has been **cleared** by aligning the site with the owner’s choice: **no user testimonials**; case studies remain.

**Primary remaining gaps:** tighten **“Michael” vs “we”** voice, soften **absolute “always”** phrasing, fix **technical debt** (`--font-display` undefined while pages load Fraunces/Lexend, FAQ accordion `aria-controls` / hidden state, sitewide GA4), and continue **UX** work (CTA wording, hero outcome clarity, video placeholder, thank-you page).

Benchmark firms (Bay Area / estate + family patterns) reinforce moves you already use (clear geography, education-first, calm probate framing). Gated opportunities: **life-change strip**, **incapacity named once calmly**, **value pillars**, and **post-submit thank-you orientation**—without implying **family law** services you do not list.

---

## Top five wins (highest leverage) — refreshed

1. ~~P0 testimonial/schema/legal alignment~~ **Done** (see revision note above).
2. **Define `--font-display` (or stop using it)** — Match `styles.css` variables to loaded fonts (Fraunces + Lexend) so interior and legal page headings render as designed.
3. **Unify primary CTA wording** — Pick one label family and repeat it in nav, sticky, and hero to reduce friction.
4. **FAQ accordion accessibility** — Stable panel `id`s, `aria-controls`, `hidden` when collapsed.
5. **Voice pass (“Michael” vs “we”, “always”)** — Per copy QA skill across marketing pages.

---

## Prioritized backlog (deduplicated)

### P0 — Resolved (keep for record)

| ID   | Resolution                                                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | **`aggregateRating` removed** from `index.html` JSON-LD.                                                                                                                                                        |
| P0-2 | **`disclaimer.html` / `attorney-advertising.html`** updated: no on-site testimonial sections; prior-results language references case studies / illustrative examples only. Attorney sign-off still recommended. |
| P0-3 | **`results.html`** head tags updated to case-study-only; commented testimonial/review markup **removed** from the file.                                                                                         |

### P1 — Should fix soon

| ID    | Theme      | Finding                                                                                                                                                   | Suggested direction                                                                     |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P1-1  | Copy       | Absolute “always” / “Always here” (`index.html` pricing, `process.html` hero and lifetime support)                                                        | Soften per Agent 1 replacements                                                         |
| P1-2  | Copy       | Anonymous “we” / “us” on home, contact, FAQ, services                                                                                                     | Prefer “Michael” or “the firm” where intentional                                        |
| P1-3  | Copy       | FAQ: “We mediate options” may imply professional mediation                                                                                                | Rephrase to neutral facilitation (Agent 1)                                              |
| P1-4  | Copy       | FAQ: blanket “Formal probate needs a lawyer in California”                                                                                                | Qualify after bar review (Agent 1)                                                      |
| P1-5  | HTML       | `process.html` visible H3 uses raw `&` (“Draft & Review”)                                                                                                 | Use `&amp;`                                                                             |
| P1-6  | A11y       | FAQ accordion: no `aria-controls` / stable panel ids; collapsed content may still expose to some AT                                                       | `id` on answers, `aria-controls`, `hidden` when collapsed                               |
| P1-7  | CSS        | `--font-display` referenced across many pages but not defined in `:root`; `--serif`/`--sans` still name Cormorant/Outfit while HTML loads Fraunces/Lexend | Add `--font-display: 'Fraunces', …` and align `--serif`/`--sans` or replace inline uses |
| P1-8  | UX / IA    | `index.html` section `id="contact"` is a CTA band, not the form; all real contact is `contact.html#contact`                                               | Rename fragment or add clarifying heading (UX agent)                                    |
| P1-9  | Persuasion | Video block still “Video Coming Soon” on homepage                                                                                                         | Replace with short copy or embed when ready                                             |
| P1-10 | Analytics  | GA4 only on `index.html`                                                                                                                                  | Add same snippet to all pages if sitewide metrics are required                          |

### P2 — Nice to have / polish

| ID    | Theme       | Finding                                                                                              |
| ----- | ----------- | ---------------------------------------------------------------------------------------------------- |
| P2-1  | SEO         | No `og:image` (or Twitter cards) sitewide                                                            |
| P2-2  | SEO         | `privacy-policy.html`: meta description vs `og:description` differ                                   |
| P2-3  | A11y        | Heading skips (`h1` then `h3` on process/results); footer `h4` after main `h2`                       |
| P2-4  | UX          | Thank-you page: orient wait time + link to `process.html` instead of pushing back to empty form      |
| P2-5  | UX          | Contact bottom CTA duplicates same-page anchor; swap for “what happens after you send”               |
| P2-6  | UX          | Sticky CTA appears only after ~80% viewport scroll (`main.js`); consider earlier threshold on mobile |
| P2-7  | A11y        | `autocomplete` on contact fields; `aria-hidden` on decorative SVGs                                   |
| P2-8  | A11y        | Mobile nav: optional `inert` on main/footer, scroll lock                                             |
| P2-9  | Performance | Font payload / subsetting for Lexend weights                                                         |
| P2-10 | Content     | “Why choose us” → reader-centric title (“Why clients choose Michael”)                                |
| P2-11 | Maintenance | Annual refresh for California probate thresholds and statutory fee examples (`$184,500`, fee table)  |

---

## Work classification

| Area                   | Backlog IDs                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Legal / compliance** | ~~P0-1 — P0-3~~ resolved; P1-4 (wording), P2-11 (statutory numbers); optional counsel pass on revised disclaimer / attorney-advertising |
| **Copy / voice**       | P1-1 — P1-3, P1-5, P2-10                                                                                                                |
| **UX / persuasion**    | P1-8, P1-9, P2-4 — P2-6, benchmark ideas below                                                                                          |
| **Tech / SEO / a11y**  | P1-6, P1-7, P1-10, P2-1 — P2-3, P2-7 — P2-9                                                                                             |

---

## Gaps vs benchmark patterns (estate + family-informed, estate-only positioning)

Firms reviewed (pattern source only): De Fonte Law, O’Grady Law Group, Irene Zhu Law, Michnicka Law, Rodriguez Lagorio LLP, Anthoor Law Group, Jones & Devoy LLP.

Your site already matches strong boutique patterns: **geography + practice clarity**, **education before sell**, **probate cost context** with qualifiers. Compared to dual-practice firms, you correctly **avoid divorce/custody** services in the nav; the opportunity is to borrow **lifecycle empathy** (“marriage, birth, moves”) as **estate-plan triggers only**, with a visible line that **family law matters are outside scope** or simply omitted if unnecessary.

**Ten gated “imitation ideas”** (from Agent 4; do not copy competitor prose):

1. Three parallel **outcome subheads** under the hero before long copy — risk: must map to real deliverables.
2. Homepage block on **how fees are set** (flat vs hourly) — risk: bar review and accuracy.
3. One calm **incapacity** line tied to POA/healthcare docs — risk: stay in legal scope, not medical advice.
4. **“When to update”** strip for life events — risk: do not read as offering divorce representation.
5. Dedicated **probate awareness** entry (article or linked explainer) — risk: disclaimers for any tool-like content.
6. Split CTAs only if **ops** can route new vs existing clients — risk: dropped leads.
7. **Value pillars** (education, access, customization) with proof — risk: avoid empty claims.
8. **Trustee checklist** or PDF narrative if you actually deliver it — risk: do not advertise materials you lack.
9. **Recognition row** below the fold — risk: stale or unverifiable honors.
10. **Short education strip** (timely CA topics) — risk: content maintenance burden.

---

## Appendix A — Agent 1 (Copy / legal) highlights

- Strengths: SF placement, starting-at pricing, illustrative case framing, aligned address/email.
- **Post-audit:** Testimonial / ratings / meta / legal-page cluster **addressed** (no on-site testimonials; no `aggregateRating` in schema).
- Remaining copy work: P1-1 — P1-5 in the table above (voice, absolutes, FAQ mediation/probate lines, `&amp;` on process headings).
- Verify over time: 20+ years copy, bar “good standing,” response-time promises, case-study dollar amounts.

---

## Appendix B — Agent 2 (UX / persuasion) rubric snapshot

| Criterion                                | Score (1–5) |
| ---------------------------------------- | ----------- |
| Clarity of outcome (hero)                | 3           |
| You-language / empathy                   | 3           |
| Trust vs hype                            | 4           |
| CTA discipline                           | 4           |
| Objection handling (FAQ/process/pricing) | 4           |
| Social proof (results)                   | 2–3         |

Scores reflect the **original** audit. Results now rely on **anonymized case studies only** (no testimonial quotes); social-proof score may rise slightly once video or additional illustrative content ships, or stay modest by design.

CTA map summary: almost all primary paths go to `contact.html#contact`; sticky visibility is scroll-gated in `main.js`.

---

## Appendix C — Agent 3 (Tech / SEO / a11y) — non-duplicate rows

See P1/P2 table above for integrated items. Additional notes: internal `services.html` fragment IDs for footer links are valid; `thank-you.html` `noindex` is appropriate.

---

## Appendix D — Agent 4 (Benchmark) — firms list

1. <https://defontelaw.com/>
2. <https://www.ogradylaw.com/>
3. <https://www.irenezhulaw.com/>
4. <https://www.michnickalaw.com/>
5. <https://lagoriolaw.com/>
6. <https://anthoorlawgroup.com/>
7. <https://jonesdevoy.com/>

---

## Follow-up (optional)

- Have counsel **skim revised** `disclaimer.html` and `attorney-advertising.html` (testimonial sections removed; prior-results language updated).
- Run a short **verification pass** on remaining P1/P2: Rich Results Test on `index.html` JSON-LD (without reviews), mobile FAQ + nav, font variables.
- If the firm later **opts in** to testimonials or third-party ratings, re-add substantiated visible content **before** any schema or legal copy that references them.
