# Client Pipeline — Microsoft 365 Build Specification

This document is the build spec for the client intake and matter pipeline
behind lehr-law.com: SharePoint lists, Power Automate flows, Microsoft
Bookings, e-signature, and Clio boundaries. The website side (two-path CTAs,
the contact form contract, and the onboarding page) is already implemented
in this repository; everything below is built in the firm's Microsoft 365
tenant by an administrator.

Status of this spec: reviewed against an independent plan review
(July 2026). Items marked **[Decision D#]** require Michael's approval
before that piece goes live — the full checklist is in
[Decisions for Michael](#decisions-for-michael).

Nothing in this document is legal advice; sections touching signing
formalities, client funds, and conflict checks exist to be _reviewed and
corrected by Michael_, not to define legal procedure.

---

## 1. Pipeline at a glance

```
Website visitor
   ├── PRIMARY: "Book a Free Consultation"  → Microsoft Bookings (shared page)
   └── SECONDARY: "Send a message"          → Web3Forms → email to michael@lehr-law.com
                     │                                        │
                     ▼                                        ▼
              Flow A/B/C (booking created/updated/cancelled)  Flow D (email parse)
                     └──────────────┬─────────────────────────┘
                                    ▼
                    SharePoint list: CLIENT PIPELINE  (one row per prospective matter)
                                    │  Stage changes drive Flow E (stage engine)
   Consult → Intake review → Fee agreement (e-sign) → GATED acceptance ("Engaged")
       → client folder created → product playbook timeline → calendar + tasks
       → signing ceremony (in person: sign, notarize, second payment via Clio)
       → funding follow-up → complete
                                    │
                    Flow F: daily digest to Michael   Flow G: capped client nudges
```

Two goals drive every design choice: **less administrative load on Michael**
(he works from one daily digest and one list, not his inbox) and **higher
perceived service for clients** (instant acknowledgment, a personal timeline,
proactive reminders, nothing dropped).

---

## 2. Prerequisite: shared Bookings page

The site currently links to Michael's personal "Bookings with me" page.
Personal booking pages **cannot trigger Power Automate flows and cannot ask
custom questions** — the Bookings connector's appointment triggers require
the _Bookings business SMTP address of a shared booking page_, and only
Bookings admins can create appointment-trigger flows (max 5 flows per
Bookings mailbox). Sources:
<https://learn.microsoft.com/en-us/microsoft-365/bookings/power-automate-integration>
and <https://learn.microsoft.com/en-us/connectors/microsoftbookings/>.

Create a shared Bookings page (e.g. **"Lehr Law – Consultations"**):

- **Public service — "Estate Planning Consultation"**
  - Label wording ("Free" vs "Complimentary") **[D2]**; duration, buffer,
    scheduling notice, cancellation window, and location options Michael
    actually supports **[D6]**
  - Confirmation/reminder email templates and a short
    no-attorney-client-relationship notice, approved by Michael **[D17]**
  - **Custom questions** (answers arrive in the flow trigger payload):
    1. What do you need help with? — the product _labels_ from the
       [product contract](#3-product-contract) (mapped to codes in Flow A)
    2. How did you hear about the firm?
    3. Briefly, what prompted this? — with guidance **not** to include
       confidential detail. Never invite asset, beneficiary, health, or
       adverse-party specifics in the public form.
- **Internal service — "Signing Ceremony" (60–90 min)**, hidden from the
  public page. Document how it is scheduled internally (from the Bookings
  calendar, not the public link).

When the page exists, update `public/js/booking-url.js` in this repo (one
line) — every CTA on the site follows it.

## 3. Product contract

Canonical taxonomy lives in
[`public/js/product-contract.json`](../public/js/product-contract.json)
(`contract_version: 1`). Codes are stable database keys; labels are display
text. The same values must be used everywhere:

| `product_code`                  | Label                         |
| ------------------------------- | ----------------------------- |
| `TRUST_PACKAGE`                 | Complete Living Trust Package |
| `WILL_ONLY`                     | Will Only                     |
| `POWER_OF_ATTORNEY`             | Power of Attorney             |
| `ADVANCE_HEALTH_CARE_DIRECTIVE` | Advance Health Care Directive |
| `PROBATE_ADMINISTRATION`        | Probate Administration        |
| `TRUST_ADMINISTRATION`          | Trust Administration          |
| `TRUST_AMENDMENT`               | Trust Amendment               |
| `ELDER_LAW`                     | Elder Law                     |
| `NOT_SURE_OTHER`                | Not sure yet / another need   |

Open taxonomy decisions: final inventory and whether Trust Funding becomes
a selectable product **[D3]**; whether Elder Law stays **[D4]**; whether
"Not sure" and "Other" remain combined **[D5]**. Any change bumps
`contract_version` and updates: the form options in
`public/contact.html`, the JSON file, the SharePoint choice column, the
Bookings custom question, and the Flow D parser.

**Website form contract (v1, already implemented).** The Web3Forms
notification email arrives with subject
`[INTAKE] <label> — <first> <last>` and body fields in this order:
`first_name, last_name, email, phone, product_code, service, message,
form_source, contract_version`, where `form_source = lehr-law-contact`.
Do not rename or reorder without a contract-version bump.

## 4. SharePoint structure

One **private** team site (e.g. "Lehr Law Practice"): restricted
membership, MFA enforced for members, audit logging on, external sharing
limited to the file-request mechanism in §8.

### 4.1 List: `Client Pipeline`

One row per **prospective matter** — not per person. Spouses/partners are
one matter with joint-client fields; a returning client gets a new row.
**Email identifies candidate matches only, never conclusively identifies a
matter** — flows that find multiple plausible matches create a review task
instead of overwriting.

| Group               | Columns                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity            | `Title` ("Last, First — Product"), `LeadID` (GUID at first contact), `MatterID` (assigned at engagement), `FirstName`, `LastName`, `JointClientFirstName`, `JointClientLastName`, `Email`, `AlternateEmail`, `Phone`, `PreferredContactMethod` |
| Intake/origin       | `Source` (Booking / Website Message / Phone / Referral), `DesiredProductCode`, `DesiredProductLabel`, `Web3FormsMessageID`, `InternetMessageID`, `BookingAppointmentID`, `BookingServiceID`, `ReferralSource`, `InquiryReceivedAt`             |
| Status/control      | `Stage` (below), `StageChangedAt`, `PreviousStage`, `LastProcessedEventKey`, `LastActivityAt`, `ClosedReason`                                                                                                                                  |
| Consult/engagement  | `ConsultStart`, `ConsultEnd`, `ConsultTimeZone`, `ConsultLocationType`, `ConflictCheckStatus`, `ConflictCheckCompletedAt`, `EngagementDate`, `AgreementStatus` (Not sent / Sent / Signed), `ESignAgreementID`, `FeeQuoted`                     |
| Payment (manual v1) | `ClioMatterID`, `DepositStatus`, `DepositRequestedAt`, `DepositPaidAt`, `FinalPaymentStatus`, `FinalPaymentRequestedAt`, `FinalPaymentPaidAt`, `PaymentStatusConfirmedBy`, `PaymentStatusConfirmedAt`                                          |
| Timeline            | `Expedited`, `ExpeditedFeeConfirmed`, `TimelineVersion`, `TimelineGeneratedAt`, `TargetSigningDate`, `SigningStart`, `SigningEnd`, `SigningTimeZone`, `SigningLocation`, `RecalculateTimeline`                                                 |
| Comms/nudges        | `OnboardingSent(At)`, `IntakeReceived(At)`, `IntakeNudgeCount`, `LastIntakeNudgeAt`, `AgreementNudgeCount`, `LastAgreementNudgeAt`, `NextAction`, `NextActionDue`                                                                              |
| Documents           | `ClientFolderURL`, `FileRequestURL`, `FileRequestClosedAt`, `Notes`                                                                                                                                                                            |

**Stages:** `New Inquiry → Consult Scheduled → Consult Held → Intake Under
Review → Fee Agreement Sent → Engaged (Accepted) → Drafting → Client Review
→ Signing Scheduled → Signed & Paid → Funding/Follow-up → Complete`.
Off-ramps: `Declined`, `No Response`, `Not a Fit`, `Consult Cancelled`.

Enable list **versioning** (required by the stage engine's change
detection). Index `Email`, `Stage`, `NextActionDue`.

### 4.2 List: `Pipeline Activity` (append-only audit + idempotency ledger)

`ActivityID`, lookup to the pipeline item, `EventType`, `EventSource`,
`EventTimestamp`, `ActorOrFlow`, `CorrelationID`, `EventKey`, `Summary`,
`Outcome`, `ErrorDetails`. Every flow writes here; the stage engine checks
`EventKey` here before acting. This — not the `Notes` field — is the audit
trail a human can read top to bottom.

### 4.3 List: `Matter Tasks`

`TaskID`, pipeline lookup, `ProductCode`, `TemplateTaskCode`,
`TimelineVersion`, `TaskName`, `DueDate`, `Status` (Not started / Waiting
on client / Done), `OwnerType` (Michael / Client — "Client" means _waiting
on the client_, it does not grant list access), `AssignedTo`,
`CalendarEventID`, `CompletedAt`, `ManualOverride`, `OverrideReason`.

### 4.4 List: `Product Playbooks` (configuration)

`ProductCode`, `PlaybookVersion`, `TemplateTaskCode`, `TaskName`,
`OffsetDays`, `ExpeditedOffsetDays`, `OwnerType`, `CreateCalendarEvent`,
`CalendarShowAs` (Free / Tentative / Busy), `ClientVisible`, `Sequence`,
`Active`.

Timelines are data-driven: Michael edits durations here, not inside flows.
**Playbooks are versioned** — editing rows creates a new `PlaybookVersion`;
timelines already issued to clients never silently change. Example rows for
`TRUST_PACKAGE` (illustrative; Michael sets real numbers, and expedited
offsets stay internal until the expedited offer is defined **[D16]**):

| Seq | TemplateTaskCode | Task                       | Offset | Expedited | Calendar   | ClientVisible |
| --- | ---------------- | -------------------------- | ------ | --------- | ---------- | ------------- |
| 1   | `SEND_INTAKE`    | Send intake questionnaire  | 0      | 0         | No         | Yes           |
| 2   | `DESIGN_MEETING` | Design meeting             | 10     | 4         | Yes (Busy) | Yes           |
| 3   | `DRAFTS_OUT`     | Drafts to client           | 24     | 10        | No         | Yes           |
| 4   | `REVISIONS_DONE` | Revisions complete         | 31     | 14        | No         | Yes           |
| 5   | `ARRANGE_NOTARY` | Arrange notary & witnesses | 33     | 15        | No         | No            |
| 6   | `SIGNING`        | Signing ceremony           | 38     | 17        | Yes (Busy) | Yes           |
| 7   | `FUNDING_CHECK`  | Funding follow-up          | 68     | 45        | No         | Yes           |

### 4.5 Document library: `Clients` (the client parcel)

- Major **versioning on** — documents are tracked as they change over time;
  a "Recently modified" view gives Michael the pulse across all matters.
- Folder per matter named `MatterNumber - ShortName` (no full names or
  legal narratives in URLs), cloned from a `_Template` folder:
  `01 Intake / 02 Engagement and Fees / 03 Drafts / 04 Executed Documents /
05 Funding and Transfers / 06 Correspondence`, with product-specific
  staged placeholder docs under `_Template/<ProductCode>/`.
- **Prove the cloning method** before relying on it: standard SharePoint
  copy actions do not reliably clone nested folder trees; the fallback is a
  flow that enumerates the template and recreates folders/files (or a
  "Send an HTTP request to SharePoint" action). Test with the real
  template.
- Retention per Michael's client-file policy **[D13]**; sensitivity labels
  if licensed.

## 5. Power Automate flows

All standard connectors — no Premium license required. **Every flow uses
the same skeleton:** validate trigger → establish correlation ID → check
idempotency (stored IDs / `EventKey` in Pipeline Activity) → main actions
in a Try scope → record success in Pipeline Activity → Catch scope on
failure/timeout → record sanitized error → notify Michael minimally → mark
the record for retry or manual review.

**Retry rules (apply to every flow):** never create a second matter, task,
or calendar event when a stored ID or deterministic key already exists;
never resend a client-facing email because a later unrelated action failed;
Michael can retry a failed step without replaying the whole lifecycle.

### Flow A — Booking created

Trigger: Bookings "When an appointment is created" (shared page mailbox).

1. Idempotency: skip if `BookingAppointmentID` already recorded.
2. Map the custom-question product label → `DesiredProductCode`.
3. Search `Client Pipeline` for open items matching the customer email:
   none → create (Stage `Consult Scheduled`, new `LeadID`); exactly one →
   update it; multiple → create a **review task** for Michael instead of
   guessing.
4. Store `ConsultStart/End/TimeZone`, `BookingServiceID`, location.
5. Send the acknowledgment email: confirmation recap, link to
   [what-to-expect.html](https://www.lehr-law.com/what-to-expect.html)
   (the onboarding content), what-to-bring summary. Set `OnboardingSent`.
6. Do **not** create a calendar event — Bookings already did.
7. Log to Pipeline Activity.

### Flow B — Booking updated

Trigger: Bookings "When an appointment is updated".
Match by `BookingAppointmentID`; update schedule fields and any pending
reminders; notify Michael if a material field changed; **no** duplicate
new-booking acknowledgment; log old → new schedule summary.

### Flow C — Booking cancelled

Trigger: Bookings "When an appointment is cancelled".
Match by `BookingAppointmentID`; set Stage `Consult Cancelled` with a
`NextAction` for follow-up; cancel pipeline-created reminders; keep the
lead row; send a rebooking link only if Michael approves that policy
**[D6]**; log.

### Flow D — Website message intake

Trigger: Outlook "When a new email arrives (V2)" in michael@lehr-law.com.

1. **Authenticity — never trust the subject alone.** Require all of:
   arrival in the dedicated mailbox folder (set up an Outlook rule for
   Web3Forms sender characteristics), exact `[INTAKE]` subject prefix,
   `form_source: lehr-law-contact` present in the body, and all required
   fields present.
2. Idempotency: skip if this `InternetMessageID` was already processed.
3. Parse the body's `Field: value` lines per the §3 contract; tolerate
   both HTML and plain-text renderings. Store the raw message ID and a
   link to the email; do not copy raw HTML into SharePoint.
4. Same match/create logic as Flow A → Stage `New Inquiry`,
   Source `Website Message`.
5. Acknowledgment to the client — **only if the client email parsed
   confidently**: "received, here's what happens next" + link to
   what-to-expect.html + **the booking link** (converting message-senders
   into booked consults is the single biggest service win).
6. Notify Michael (Teams/mobile) with the parsed summary — no need to read
   raw form emails.
7. **Error path:** log a Pipeline Activity error, categorize the email
   `[NEEDS MANUAL ENTRY]`, notify Michael with minimal detail, send no
   acknowledgment. Nothing is silently dropped.

Before building, submit the real form once and keep a **sanitized fixture**
of the actual Web3Forms email. Test the parser against: all fields present;
blank phone; multiline message; special characters and non-ASCII names;
long message; HTML vs plain-text; duplicate delivery; spoofed subject with
missing `form_source` (must be rejected).

### Flow E — Stage engine

Trigger: SharePoint "When an item is modified" on `Client Pipeline`, with
**loop and duplicate protection**:

- List versioning on; use **"Get changes for an item or a file (properties
  only)"** with the trigger-window tokens and proceed only if `Stage` (or
  `RecalculateTimeline`) actually changed.
- Concurrency control on the trigger (degree 1) to serialize rapid edits.
- Deterministic event key `ItemID|Stage|TimelineVersion`; skip if that key
  already exists in Pipeline Activity; write the completion record only
  after all critical actions succeed.
- Reference:
  <https://learn.microsoft.com/en-us/sharepoint/dev/business-apps/power-automate/sharepoint-connector-actions-triggers>

`Switch` on the new Stage:

- **`Consult Held`** → send the intake questionnaire (see §9 gap — a
  Microsoft Form; responses filed to `01 Intake`) and create the intake
  reminder task. Nudge flow starts watching `IntakeReceived`.
- **`Fee Agreement Sent`** → send the fee agreement + engagement letter
  through the Adobe Acrobat Sign or DocuSign connector **[D11]** with
  merged fields (names, product, `FeeQuoted`, deposit per the fee
  agreement). A companion flow on the vendor's "agreement completed"
  trigger saves the signed PDF to `02 Engagement and Fees`, sets
  `AgreementStatus = Signed` + `ESignAgreementID`, and notifies Michael to
  send the Clio deposit request.
- **`Engaged (Accepted)`** — **gated, see §6.** Then: assign `MatterID`;
  create the client folder from `_Template` (write `ClientFolderURL`
  back); read the active playbook for the product and generate the
  timeline (§7); create `Matter Tasks` rows and calendar events; send the
  client a welcome email with their **personal timeline** (client-visible
  tasks only) — the single highest perceived-service moment in the
  pipeline.
- **`Signing Scheduled`** → confirmation email with date/location,
  **product-specific signing requirements** (§10.1): valid photo ID for
  the notary, witness arrangements; second-payment instructions per the
  fee agreement (Clio payment link or bring-a-check) **[D9/D10]**.
  Reminders at T-3 and T-1 days via the scheduled checker — **not**
  `Delay until` (flow runs are limited to 30 days:
  <https://learn.microsoft.com/en-us/power-automate/limits-and-config>).
- **`Signed & Paid`** → thank-you email + funding instructions (reuse the
  site's trust-funding checklist content) + `05 Funding` tasks + 30/60-day
  check-in reminders.
- **`Declined` / `Not a Fit`** → approved close-out template **[D17]**;
  suppress all nudges.

### Flow F — Daily digest (the "less admin" flow)

Scheduled, weekday mornings. One email/Teams message with:

1. Due today, 2. Overdue, 3. Consultations in the next two business days,
2. Waiting on client, 5. Waiting on Michael, 6. Unprocessed flow errors,
3. Stale matters (no activity in N days), 8. Unmatched booking/Web3Forms
   records.

Keep confidential detail out of push notifications — link to the secured
list item instead. Michael runs his day from this digest, not his inbox.

### Flow G — Client nudges

Scheduled checker (not per-item delays): intake not received N days after
`Consult Held`; agreement sent but unsigned after N days (the e-sign
vendor's own reminders may cover this). Controls: max nudge count (2),
minimum interval, last-nudge timestamp, stop conditions (stage moved on,
matter closed/declined), a manual suppression flag, and an activity-log
entry per nudge.

### Operational dashboard (SharePoint views)

Automation errors · unmatched booking events · unparsed Web3Forms messages
· stage-not-processed · timeline generation incomplete · missing client
folder · missing next action · file request still open after intake ·
engagement gate failures.

## 6. Engagement gates

`Engaged (Accepted)` is a **gate, not a free choice**. The stage engine
verifies before running the engagement actions, and reverts the stage with
a notification if unmet:

- `ConflictCheckStatus = Cleared` (procedure defined by Michael **[D7]** —
  and a _preliminary_ conflict check happens **before** detailed
  confidential intake: basic inquiry → preliminary conflict info →
  conflict review → consultation → detailed intake → fee agreement →
  engagement)
- `AgreementStatus = Signed`
- Payment state per Michael's engagement definition **[D8/D9]** (signed
  agreement only vs + deposit vs + conflict check)
- `DesiredProductCode` is an approved code; `EngagementDate` set;
  joint-client fields resolved where applicable

An intentional override is allowed only with `OverrideReason` filled in,
and it is activity-logged.

## 7. Timeline generation and recalculation

**Generate (on engagement):** read the active `PlaybookVersion` for the
product; stamp `TimelineVersion` on the item; compute due dates =
`EngagementDate` + `OffsetDays` (or `ExpeditedOffsetDays` when
`Expedited = Yes` and `ExpeditedFeeConfirmed = Yes`); **upsert** tasks
keyed `ItemID + TemplateTaskCode + TimelineVersion`; create calendar
events only for rows with `CreateCalendarEvent = Yes`, storing each
`CalendarEventID`; build the client-facing timeline from `ClientVisible`
rows only.

**Recalculate (expedited upgrade, reschedule):** triggered by the
`RecalculateTimeline` toggle. Preserve completed tasks and manual
overrides; update unfinished system-generated tasks; update existing
calendar events **by stored event ID** (never create duplicates); cancel
obsolete events; increment `TimelineVersion` only when intentionally
issuing a new version; **preview the diff to Michael before any revised
timeline goes to the client.**

**Calendar restraint:** calendar events only for consultations, design and
review meetings, signing ceremonies, statutory/court deadlines, and blocks
Michael explicitly asks for **[D15]** — with a defined show-as. Routine
checklist work lives in `Matter Tasks` and the digest, not on the
calendar.

## 8. Security, confidentiality, governance

- **Minimum necessary intake:** the public form and Bookings questions
  never solicit asset detail, beneficiaries, disputes, health information,
  or adverse parties. (The site form now carries a visible notice to that
  effect — wording pending Michael's approval **[D17]**.)
- **Client document upload:** OneDrive/SharePoint **file requests** — one
  unique link per matter, pointing at that matter's `01 Intake` folder,
  sent only to a verified address, closed after intake
  (`FileRequestClosedAt`), creation/closure logged. Uploaders can't see
  folder contents, but uploader identity is not validated — confirm
  identity for sensitive submissions. Never one shared intake folder.
  Treat _automated_ link creation as unproven until a supported action is
  confirmed; manual link creation is the v1 default. Policy approval
  **[D14]**. Reference:
  <https://support.microsoft.com/en-us/onedrive/create-a-file-request>
- **Cal Bar technology duty:** document authorized users, MFA, device
  security, sharing restrictions, retention/destruction **[D13]**,
  backup/recovery, breach response, vendor review, and access removal on
  offboarding. See the State Bar's electronic-files resources and Formal
  Opinion 2020-203.
- **Flow ownership and continuity:** every production flow has a primary
  owner and a co-owner; connection references documented; credential
  rotation and flow export/backup procedures written down; failure alerts
  route to a monitored address. No critical flow depends on a single
  personal connection.

## 9. Clio boundary (v1)

- **System of record split:** the SharePoint list is the operational
  pipeline; **Clio is billing, payments, and trust accounting.** No native
  Clio ↔ Power Automate connector exists — v1 keeps payment steps manual:
  Michael sends Clio payment requests and records
  `DepositStatus`/`FinalPaymentStatus` (+ `PaymentStatusConfirmedBy/At`)
  on the pipeline item. `ClioMatterID` correlates the two systems.
- **Client funds:** Michael configures Clio payment destinations and
  payment-request procedures according to the signed fee agreement,
  California Rule of Professional Conduct 1.15 (including its advance
  flat-fee provisions), and his client-trust-accounting practices
  **[D10]**. The automation never decides whether funds belong in trust or
  operating accounts, and never treats payment as implying engagement on
  its own **[D8]**.
- **Later (separate project):** parsing authenticated Clio receipt emails,
  a Clio API custom connector, or a supported third-party platform — each
  with its own security/idempotency review.

Known v1 limitation: payment status is not machine-visible, so
`Signed & Paid` is Michael-asserted.

## 10. Legal execution notes (for Michael's review)

### 10.1 Signing requirements are product-specific

Create signing task templates per product/document type, each approved by
Michael **[D12]**. General references (verify current law before use):

- California wills: at least two witnesses (Prob. Code § 6110)
- Power of attorney: notary acknowledgment **or** two qualifying
  witnesses (Prob. Code § 4121)
- Advance health care directive: notary or two qualifying witnesses, with
  additional rules for electronic directives (Prob. Code § 4673)

The signing-confirmation email pulls the requirements for the matter's
product (IDs for the notary, witness logistics) from these templates —
never a generic "notary + two witnesses" line.

### 10.2 E-signature scope

Adobe Acrobat Sign and DocuSign (standard Power Automate connectors;
vendor subscription required **[D11]**) are used for the **fee agreement
and engagement letter only**. This workflow does not extend to executing
wills, trusts, POAs, or directives — those follow §10.1 in person.

## 11. Known gaps / needs definition

| #   | Gap                                                                     | v1 handling                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Personal booking page can't trigger flows                               | Build shared page first (§2) — blocks Flow A/B/C                                                                                                                                                      |
| G2  | The "detailed questionnaire" exists only on paper                       | Build as Microsoft Form; responses filed to `01 Intake` by flow; never emailed around                                                                                                                 |
| G3  | Clio has no Power Automate connector                                    | Manual payment status (§9)                                                                                                                                                                            |
| G4  | Payment not machine-visible                                             | `Signed & Paid` is Michael-asserted                                                                                                                                                                   |
| G5  | Expedited service undefined (no pricing/SLA anywhere)                   | `Expedited` stays internal until **[D16]**; playbook has the column ready                                                                                                                             |
| G6  | Conflict-check procedure undocumented                                   | Gate exists (§6); Michael defines procedure **[D7]**                                                                                                                                                  |
| G7  | Secure upload not automated                                             | Manual per-matter file-request links (§8)                                                                                                                                                             |
| G8  | Notary/witness logistics untracked                                      | Playbook rows `ARRANGE_NOTARY` etc. (§4.4, §10.1)                                                                                                                                                     |
| G9  | Email parsing is format-fragile                                         | Multi-check authenticity + fixture tests + `[NEEDS MANUAL ENTRY]` path (Flow D); upgrade path: Power Automate Premium HTTP trigger replaces email parsing without site changes beyond the form target |
| G10 | Privacy-policy/disclaimer pages may need updates for the new data flows | Flagged for lawyer review — not edited by this project                                                                                                                                                |
| G11 | Site funding checklist stores to localStorage only                      | Post-signing funding tracked via `Matter Tasks`; deeper integration later                                                                                                                             |

## 12. Build order and exit criteria

| Phase | Contents                                                                                                       | Exit criterion                                 |
| ----- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 0     | Decisions D1–D17; M365 readiness checklist (§13)                                                               | All foundational decisions documented          |
| 1     | Website changes (this repo)                                                                                    | Branch preview approved; PR merged             |
| 2     | SharePoint site, lists, library, views, indexes; shared Bookings page; permissions, flow owners, alert routing | Test records can be created safely and audited |
| 3     | Flows A–D + failed-parse queue + acknowledgments                                                               | Repeated test events create no duplicates      |
| 4     | Flow E: gates, e-sign, folders, timelines, recalculation                                                       | Every stage idempotent and recoverable         |
| 5     | Flows F–G, signing reminders, funding follow-up, error dashboard, flow backup docs                             | Michael operates from the digest               |
| 6     | Later: Clio automation, digital intake generation, file-request lifecycle automation, client portal, reporting | Scoped separately                              |

**Test matrices** (minimum): Flow D parser fixtures (§Flow D list);
Bookings create/update/cancel/duplicate-delivery/missing-answer/timezone;
stage engine double-event, two rapid edits, self-update, partial failure
after task creation, partial failure after calendar creation,
recalculation preserving completed tasks and updating (not duplicating)
events, closed matters receiving no nudges; security — unauthorized user
blocked from site and library, file-request link cannot list folder
contents and can be closed, error notifications contain no unnecessary
client details, removing a flow owner doesn't disable production flows.

## 13. M365 readiness checklist (verify before Phase 2)

Nothing about the tenant has been verified yet. Confirm: tenant and
primary domain; Michael's license; Bookings enabled by policy; shared
Bookings page created and Michael assigned Bookings administrator;
Bookings business SMTP address recorded; Power Automate environment
chosen; private SharePoint team site; Exchange mailbox for
michael@lehr-law.com; flow owner and co-owner accounts; Adobe Sign or
DocuSign account and template features; DLP policies reviewed; external
sharing / anonymous upload policy approved; MFA on all admin and
flow-owner accounts.

## 14. Decisions for Michael

1. **[D1]** Reconcile the legacy `ohdaveed/michael-lehr-law` repository:
   its recent commits ("Complimentary Consultation" wording, Elder Law
   removed, Trust Funding added, Azure Static Web Apps workflow) diverge
   from this production repo. Align or archive it so there is one source
   of truth.
2. **[D2]** "Free" vs "Complimentary" consultation wording (site currently
   says Free).
3. **[D3]** Final product inventory; is Trust Funding a selectable product
   or a supporting service?
4. **[D4]** Does Elder Law remain a selectable option? (Currently kept.)
5. **[D5]** Keep "Not sure yet / another need" combined, or split?
6. **[D6]** Consultation duration, buffer, locations, cancellation window;
   rebooking-after-cancellation policy.
7. **[D7]** Preliminary conflict-check procedure and when it runs.
8. **[D8]** When does a prospect become "engaged" (signed agreement only /
   - deposit / + conflict check)?
9. **[D9]** Deposit and final-payment requirements per product.
10. **[D10]** Clio trust vs operating account procedure under the fee
    agreement (Rule 1.15).
11. **[D11]** E-signature vendor (Adobe Sign vs DocuSign) and plan; which
    documents are e-signed.
12. **[D12]** Product-specific witness and notary arrangements (who
    provides the notary; witness sourcing).
13. **[D13]** Client-file retention and destruction policy.
14. **[D14]** External upload and sharing policy (file requests).
15. **[D15]** Which milestones belong on the calendar, and their show-as
    status.
16. **[D16]** Expedited-service pricing and service-level commitment.
17. **[D17]** Approved templates: acknowledgment, reminder, nudge,
    decline/close-out emails; the form confidentiality notice; Bookings
    page notices.
