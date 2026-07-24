# Calendly/Tally Intake → SharePoint `Client Pipeline` List

**Date:** 2026-07-18
**Status:** Implemented and live (2026-07-24) — see `webhook-server/README.md`
for setup/operation details. Email notifications ended up going through
Microsoft Graph's `/sendMail` rather than SMTP (not anticipated in this
design) because this tenant's Security Defaults policy blocks Basic Auth
SMTP outright; the same app registration's `Sites.Selected` grant was
extended with `Mail.Send` for that purpose.
**Scope:** Intake → CMS list only. Invoicing, document creation, and onboarding
automation are explicitly deferred to follow-up specs (see "Out of scope").

## Context

`docs/client-pipeline.md` is the existing (reviewed) build spec for the full
client pipeline — SharePoint lists, Power Automate flows, e-signature, Clio
boundaries. It was written assuming **Microsoft Bookings** as the consultation
booking tool, because personal booking pages can't trigger Power Automate
flows or ask custom questions.

Reality check done as part of this design: the live site's booking link
(`public/js/booking-url.js`) actually points to **Calendly**
(`calendly.com/lehrlaw/estate-planning-consultation`), not Microsoft Bookings.
`webhook-server` (already built and deployed to Railway) already receives and
validates both Tally contact-form submissions and Calendly
`invitee.created`/`invitee.canceled` events. None of `client-pipeline.md`'s
SharePoint structure (`Client Pipeline`, `Pipeline Activity`, `Matter Tasks`,
`Product Playbooks` lists) exists in the tenant yet — this is greenfield.

This design reconciles that: Calendly stays as the booking tool, and this
pass wires the two existing intake paths (Tally message, Calendly booking)
into a new SharePoint list, without redesigning the rest of
`client-pipeline.md`'s later-stage flows (those still assume their original
triggers and are out of scope here).

## Decisions made during brainstorming

- **Booking tool: Calendly** (not Microsoft Bookings — matches what's live).
- **Automation platform: direct Microsoft Graph calls from `webhook-server`**,
  not Power Automate or Make.com. Avoids an unresolved Power Automate Premium
  licensing question and a Make.com scenario rewrite; keeps all logic in the
  Node service already deployed and already handling these two webhooks.
- **Graph auth: Azure AD app registration, client-credentials flow,
  `Sites.Selected` permission**, scoped to write only to the new site — not
  `Sites.ReadWrite.All`. Chosen deliberately after this session's Calendly PAT
  exposure incident: least-privilege blast radius if the client secret ever
  leaks.
- **New dedicated SharePoint site** ("Lehr Law Practice", private), not the
  existing "Client Onboarding Center" site — that site's content (a "command
  hub" page, Retool training PDFs, presentation materials) is static
  reference material, not a live operational data store, and mixing concerns
  there would blur permissions boundaries.
- **One list, not four.** `client-pipeline.md` §4 designs four lists
  (`Client Pipeline`, `Pipeline Activity`, `Matter Tasks`, `Product
Playbooks`). This pass builds only `Client Pipeline`, with idempotency
  tracked via columns on that list itself rather than a separate audit list.
  The audit list, task list, and playbook list return when the
  invoicing/document-creation phase is designed.

## Architecture

```text
Website: "Send a message" (Tally, form ob17lb) ──┐
Website: "Book a consult" (Calendly)─────────────┤
                                                  ▼
                    webhook-server (existing, Railway)
                    - validates payload/signature (existing, unchanged)
                    - emails Michael (existing, unchanged)
                    - NEW: upserts a SharePoint row via Graph
                                                  ▼
        New site: "Lehr Law Practice" (private, restricted membership, MFA)
        New list: Client Pipeline (one row per prospective matter)
```

## Components

- **Azure AD app registration** — `Sites.Selected` application permission,
  explicitly granted write access to the new site only (via
  `POST /sites/{site-id}/permissions`, not a tenant-wide grant). Client ID,
  client secret, and tenant ID stored as Railway environment variables,
  following the same pattern as the existing SMTP/Calendly secrets.
  **The client secret must have an explicit expiration date** (Azure AD
  supports this at registration time) with a calendar reminder to rotate it
  — not a non-expiring secret. This requirement exists directly because of
  the Calendly PAT that was accidentally exposed earlier in this project's
  history; do not repeat that pattern with a credential that has tenant
  write access.
- **New SharePoint site "Lehr Law Practice"** — private, restricted
  membership, MFA enforced for all members, audit logging on (mirrors
  `client-pipeline.md` §8's governance baseline, stated explicitly here
  rather than left implicit).
- **New list `Client Pipeline`** — trimmed from `client-pipeline.md` §4.1:
  - Identity: `Title`, `LeadID`, `FirstName`, `LastName`, `Email`, `Phone`
  - Intake/origin: `Source` (Website Message / Booking), `DesiredProductCode`,
    `DesiredProductLabel`, `TallySubmissionID`, `CalendlyEventURI`,
    `InquiryReceivedAt`
  - Status: `Stage`, `StageChangedAt`
  - Consult: `ConsultStart`, `ConsultEnd`, `ConsultTimeZone`
  - `Notes` (free text — reschedule/cancel URLs, review flags)
  - Columns for invoicing, document generation, onboarding, and e-signature
    (per `client-pipeline.md` §4.1's Payment/Timeline/Comms/Documents groups)
    are **not** created yet — they're added when that phase is designed, to
    avoid guessing at a schema before the automation that uses it exists.
  - List versioning **on** (gives baseline audit trail without a separate
    `Pipeline Activity` list).
- **`webhook-server/lib/sharepoint.js`** (new module):
  - `getAccessToken()` — client-credentials grant, cached until near expiry
  - `findOpenItemByEmail(email)`
  - `createPipelineItem(fields)`
  - `updatePipelineItem(itemId, fields)`

## Data flow

**Message path** (`POST /webhooks/tally`, validation unchanged):

1. Look up an open (non-closed-stage) `Client Pipeline` row by email.
2. None found → create: `Stage=New Inquiry`, `Source=Website Message`,
   `DesiredProductCode` mapped from `Service needed` via
   `product-contract.json`, `TallySubmissionID` stored.
3. Exactly one found → update it; never move `Stage` backward.
4. More than one found → don't guess. Append
   `[NEEDS REVIEW: multiple open matters for this email]` to `Notes` on the
   newest row, and flag it explicitly in the subject line of Michael's
   existing notification email.
5. Re-delivery of the same `TallySubmissionID` → no-op.

**Consult path** (`POST /webhooks/calendly`, HMAC validation unchanged):

1. `invitee.created` → same lookup-by-email logic → create/update with
   `Stage=Consult Scheduled`, `ConsultStart/End/TimeZone`,
   `CalendlyEventURI` (the idempotency key), cancel/reschedule URLs appended
   to `Notes`.
2. `invitee.canceled` → match by `CalendlyEventURI` (not email — a cancel
   event for one matter shouldn't touch a different, newer matter for the
   same person) → `Stage=Consult Cancelled`.
3. Same multiple-match escape hatch as the message path.

**Both paths:** Michael's existing email notification is unchanged and fires
regardless of whether the SharePoint write succeeds.

**Confidentiality constraint (verified, must be preserved):** the live
Calendly event type (`Estate Planning Consultation`) currently has zero
custom questions — nothing free-text flows from the booking form into
`Notes` today. If custom questions are ever added to this event type, they
must follow the same "no confidential detail" guidance as
`client-pipeline.md` §2 (never solicit asset, beneficiary, health, or
adverse-party specifics) before their answers are allowed to flow into this
list.

## Error handling

Graph calls (auth, throttling, network) must never block the webhook
response — both Tally and Calendly retry on non-2xx, which risks duplicate
emails or rows. Order of operations: validate → send Michael's existing
email notification → attempt the SharePoint write → on failure, log it and
send Michael one additional minimal alert (e.g. "SharePoint sync failed for
jane@example.com — check Railway logs") → always return `200` to the
webhook caller regardless of the SharePoint write's outcome. No data is lost
on a sync failure since Michael's email notification already fired; the row
can be reconciled manually or by a future retry job.

## Testing

`webhook-server` has no automated tests today. This change adds:

- Unit tests for `lib/sharepoint.js`'s matching logic (none/one/multiple
  open items by email) against a mocked Graph client — the highest-risk
  logic (e.g. "open" stage filtering).
- A duplicate-delivery test: same `TallySubmissionID`/`CalendlyEventURI`
  posted twice → exactly one row.
- A Graph-failure test: mocked 401/500 from Graph → webhook still returns
  200, Michael's email still sends, alert email fires.

No changes to existing Tally/Calendly validation logic — already correct,
already covered by the README's manual curl examples.

## Out of scope (deferred to follow-up specs)

- Invoicing (Clio correlation fields, deposit/payment status)
- Document creation (Product Playbooks, timeline generation, client folder
  cloning)
- Onboarding automation (welcome email with personal timeline, intake
  questionnaire filing)
- `Pipeline Activity` audit list, `Matter Tasks` list, `Product Playbooks`
  list
- Reconciling the `client-pipeline.md` §3 discrepancy between the
  questionnaire slug referenced there (`q4MKYO`) and the one actually linked
  from the live Calendly event description (`Pdeq5P`)
- Updating `client-pipeline.md` itself to reflect Calendly instead of
  Microsoft Bookings (that document still describes the old assumption and
  should be revised or annotated separately)
