# Flow E — Stage Engine Design

**Date:** 2026-07-24
**Status:** Scoped, not yet built. This is a design/scope pass only — no code exists yet.
**Scope:** Flow E (the stage engine) as code in `webhook-server`, reacting to `Stage`/`RecalculateTimeline` changes on the `Client Pipeline` list via Microsoft Graph change notifications. Does not cover Flow F (daily digest) or Flow G (nudge scheduler) except where they create concurrency risk for Flow E (§7). Does not cover the Clio integration itself (`client-pipeline.md` §9 keeps that manual).

## Context

`docs/client-pipeline.md` is the existing (reviewed) build spec for the full client pipeline — SharePoint lists, Power Automate flows, e-signature, Clio boundaries. It assumed Power Automate as the automation platform throughout, including for Flow E.

In practice, Flows A–D were never built as Power Automate. Per the "Reality check" banner at the top of `client-pipeline.md` and `docs/superpowers/specs/2026-07-18-calendly-intake-to-sharepoint-design.md`, they were built as direct Microsoft Graph calls from `webhook-server` (Node/Railway) — a deliberate decision made to avoid an unresolved Power Automate Premium-licensing question and to keep all logic in the one already-deployed Node service. Everything from `client-pipeline.md` §4.2 onward (the `Pipeline Activity` list, Flow E, e-signature, Clio boundary) remained an unbuilt future plan until 2026-07-24, when the `Client Pipeline` list's Choice-column schema and the new `Pipeline Activity` list were built out in the tenant to match §4.1/§4.2 exactly (not yet reflected in `client-pipeline.md` itself — that update is separate follow-up work).

**Decision made during this scoping pass:** Flow E follows the same precedent as Flows A–D — it is code in `webhook-server`, not a Power Automate flow. Stage-change detection uses Microsoft Graph change-notification subscriptions on the `Client Pipeline` list (the Graph-native equivalent of Power Automate's SharePoint trigger).

Two Graph facts were verified against Microsoft's documentation during this scoping pass (not assumed from the original Power-Automate-era doc):

- SharePoint `list` resources support subscription expiration up to **42,300 minutes (~30 days)** — comfortably longer than a literal reading of the old design implied, so a renewal job can run on a simple daily cadence rather than needing to survive a multi-day cliff.
- List-change notifications **never include the changed data itself** (`resourceData` is empty for this resource type) — a delta query against the list is required on every notification to determine what actually changed. This mirrors the original Power Automate design's own use of "Get changes for an item or a file (properties only)," for the same underlying reason.

One assumption from earlier background research was corrected during this pass: `webhook-server` already has `node:test` coverage for every `lib/*.js` module (`pipeline-sync.test.js`, `product-contract.test.js`, `sharepoint.test.js`, `graph-client.test.js`, `mailer.test.js`, `server.test.js`, run via `npm test`). The actual gap is that `.github/workflows/ci.yml` never invokes `npm test` for `webhook-server` — CI only runs the root site's `format:check`/`html:check`/Playwright e2e/build. So the honest framing is "tests exist and are invisible to CI," not "no tests." Phase 1 below treats wiring that in as a small, concrete fix alongside Flow E's first phase, not a separate future cleanup.

## 1. Architecture

### 1.1 Subscription resource and lifecycle

```json
POST https://graph.microsoft.com/v1.0/subscriptions
{
  "changeType": "updated",
  "notificationUrl": "https://<railway-url>/webhooks/graph-pipeline",
  "resource": "sites/{site-id}/lists/{list-id}",
  "expirationDateTime": "<now + up to 42300 minutes>",
  "clientState": "<shared secret>"
}
```

**Validation handshake:** when Graph receives the subscription-creation request, it immediately issues a `POST` to `notificationUrl` with a `validationToken` query parameter and expects the endpoint to echo that token back as `text/plain`, `200 OK`, within 10 seconds. The new handler must special-case this before touching any Graph/SharePoint state — it happens before a subscription exists to look anything up against.

**`clientState` as the authenticity mechanism:** `webhook-server` already validates authenticity for the Calendly webhook via an HMAC-signed timestamp+body compared with `crypto.timingSafeEqual` (`server.js`, `validateCalendlySignature`). Graph's `clientState` is not HMAC — it's a static shared string Graph echoes back verbatim on every notification — so the equivalent check is a **constant-time string comparison** against a new env var (`GRAPH_SUBSCRIPTION_CLIENT_STATE`), still using `crypto.timingSafeEqual` (buffers, not `===`), consistent with this repo's existing care about timing attacks on comparisons. Treat this env var with the same rotation discipline as `CALENDLY_WEBHOOK_SIGNING_KEY` — a Railway env var, never committed.

### 1.2 Renewal job

A daily renewal check comfortably clears the ~30-day expiration window with margin. Recommended: an in-process `setInterval` in `server.js` (checked every ~12 hours; renews anything expiring within the next 48 hours), rather than external cron infrastructure — consistent with "one service, no new infra." Trade-off worth noting: an in-process interval is invisible if Railway restarts and its next tick hasn't fired before a subscription lapses; mitigated by checking immediately on process start, not only on the interval.

### 1.3 Delta query on notification

The Graph-native equivalent of Power Automate's "Get changes for an item or a file (properties only)" is:

```
GET https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{list-id}/items/delta
```

using a stored `@odata.deltaLink` from the previous call to fetch only items changed since then — falling back to a full initial sync if no delta link is stored yet, or on a `410 Gone` reset response (a documented delta-query behavior, must be handled explicitly). Each returned item carries **current** field values, not a diff of which fields changed — so "did `Stage` actually change" detection has to happen in application code (see §2.1), not be assumed from receiving a notification at all.

### 1.4 Fast-ack / async-processing split

`webhook-server` already has the pattern needed, live today for both `/webhooks/tally` and `/webhooks/calendly`: respond to the caller before any Graph work, then continue in a fire-and-forget `async` block with a `.catch()` that only logs. The new `/webhooks/graph-pipeline` handler reuses this shape:

1. If `req.query.validationToken` is present → respond immediately, `text/plain`, echoing the token. Nothing else runs.
2. Else, validate `clientState` on every notification in the payload's `value[]` array (Graph batches multiple notifications per POST) — reject the whole batch with 401 if any entry fails the check.
3. Respond `202 Accepted` immediately (satisfies the ~3-second SLA Graph enforces on notification endpoints).
4. For each notification, enqueue `{ itemId, subscriptionId }` onto an in-process async queue that performs the delta fetch and dispatches to the stage engine — inside the same `.catch()`-guarded convention already used by the other two handlers.

### 1.5 New modules

Following the existing factory-function/injectable-deps convention (`createGraphClient({...})`, the pattern in `lib/sharepoint.js` and `lib/pipeline-sync.js`):

- **`lib/subscriptions.js`** — `createSubscription()`, `renewSubscription(subscriptionId)`, `listActiveSubscriptions()`, `ensureSubscription()` (idempotent: creates one if none exists, renews if near expiry).
- **`lib/pipelineActivity.js`** — new client for the `Pipeline Activity` list: `findActivityByEventKey(eventKey)`, `recordActivity(fields)`. Makes the idempotency check in §2 real.
- **`lib/stageEngine.js`** — the switch-case dispatcher (§4), the engagement-gate check (§3), one handler function per Stage case.
- **`lib/pipelineItemLock.js`** — the in-process per-item serialization primitive (§2.2, §7): a `Map<itemId, Promise>` mutex so overlapping async work for the same item queues rather than races.
- **`lib/graph-client.js`** — reused unchanged; already generic, no SharePoint-specific knowledge.

## 2. Idempotency and concurrency

Translating `client-pipeline.md` §5's shared skeleton (validate → correlation ID → idempotency check → Try → record success → Catch → record sanitized error → notify Michael minimally) into code:

### 2.1 Deterministic event key + Pipeline Activity as the correctness guarantee

```
eventKey = `${itemId}|${stage}|${timelineVersion}`
```

Before running any case's actions, `stageEngine.js` calls `pipelineActivityClient.findActivityByEventKey(eventKey)`. If a `Success` record already exists, the run is a no-op. The success record is written **only after every critical action in the case has completed** — a partial failure midway must not write it, so a retry re-attempts the remaining steps rather than silently marking the stage "handled." This is the direct translation of the doc's "partial failure after task creation" / "partial failure after calendar creation" test cases (§12 of `client-pipeline.md`).

**Self-update loop guard** (a design gap the source doc doesn't address — Power Automate's own trigger handled this differently, and there's no documented 1:1 Graph translation): because Graph list-change notifications fire on _any_ item update, and Flow E's own successful completion writes fields back onto the same item (`PreviousStage`, `StageChangedAt`, `ClientFolderURL`, `TimelineVersion`, etc.), that write generates a new notification. Proposed mechanism, using columns that already exist (no new schema needed for this):

- On every notification, after the delta fetch, compare `fields.Stage` to `fields.PreviousStage`.
- Equal → nothing pending (either nothing changed, or Flow E's last run already advanced `PreviousStage` to match) → skip.
- Different → real transition → process it, and as the last step of a successful run, set `PreviousStage = <the Stage just processed>` and `StageChangedAt = now`. The resulting self-triggered notification then sees `Stage === PreviousStage` and no-ops.
- Same pattern for `RecalculateTimeline`: treat as toggle-and-reset — falsy means nothing to do; a real request processes it and resets it to `No` on success.

### 2.2 Per-item serialization: lock is an optimization, Pipeline Activity is the guarantee

`client-pipeline.md`'s "concurrency control degree 1" becomes an in-process `Map<itemId, Promise>` in `lib/pipelineItemLock.js`: `withItemLock(itemId, fn)` chains `fn` onto whatever's currently queued for that `itemId`, so two notifications for the same item arriving close together process strictly one after another within this process. **This is a race-reduction optimization only, not the correctness mechanism** — it does nothing across a process restart (the Map is empty on boot) or across a second Railway replica if the service is ever scaled beyond one instance. The actual guarantee is the `Pipeline Activity` `EventKey` check (§2.1), which is durable and survives both.

## 3. Engagement gate (`Engaged (Accepted)`, `client-pipeline.md` §6)

Runs as the first step of the `Engaged (Accepted)` case, before any engagement action:

```
canEngage =
  fields.ConflictCheckStatus === "Cleared"
  && fields.AgreementStatus === "Signed"
  && checkPaymentState(fields)  // stubbed — see below
  && isValidProductCode(fields.DesiredProductCode)
  && Boolean(fields.EngagementDate)
```

On failure: revert `Stage` to `fields.PreviousStage` (the same column used for loop-detection in §2.1), write an activity record with `Outcome = Failed` naming which check(s) failed, notify Michael with the same minimal-detail tone as the existing SharePoint-sync-failure alert email. `OverrideReason`, if present and non-empty at the time the gate runs, bypasses the failed check(s) — but still writes a `Pipeline Activity` entry recording that an override occurred and what it bypassed, per the doc's "it is activity-logged" requirement.

**Blocked pending decisions:** `ConflictCheckStatus` semantics depend on **D7** (procedure isn't defined — only the column's three values exist); the payment-state check depends on **D8/D9** (what "engaged" requires) and indirectly **D10** (trust vs. operating account procedure). **Unblocking approach:** implement the gate with the three checks that already have concrete, unambiguous semantics (`ConflictCheckStatus`, `AgreementStatus`, product code, `EngagementDate`) live and enforced now; implement `checkPaymentState(fields)` as a named stub — always returns `true`, logs a loud warning, writes a `Pipeline Activity` note ("payment-state check not yet implemented — D8/D9 pending") — so the gate's shape and every other check are real and testable today, and swapping in the real check later is a one-function change.

## 4. Switch-case breakdown

### `Consult Held`

Send the intake questionnaire (Microsoft Form — gap **G2** in `client-pipeline.md` §11, not yet built) and create the intake reminder task.

**Flagged inconsistency in `client-pipeline.md` itself** (not previously noted anywhere): the questionnaire's responses are described as being "filed to `01 Intake`" — a subfolder of the client folder — but the client folder isn't created until the _later_ `Engaged (Accepted)` case. Intake happens before engagement in the pipeline (§1 of the doc), so the filing destination for `Consult Held`'s questionnaire doesn't exist yet when it's needed. This needs Michael's input: create a minimal folder earlier, stage responses somewhere until the folder exists, or don't file until engagement and treat `Consult Held` as send-only. Not resolved here — surfaced as an open question.

**Recommended stub:** implement "create the intake reminder task" now; stub "send the questionnaire" as a manual task/notification to Michael until G2 and the folder-sequencing question are both resolved. Smallest, most self-contained case — good Phase 1 target.

### `Fee Agreement Sent`

Send the fee agreement + engagement letter through Adobe Acrobat Sign or DocuSign with merged fields (names, product, `FeeQuoted`, deposit); a companion webhook reacts to the vendor's "agreement completed" event, saves the signed PDF, sets `AgreementStatus = Signed` + `ESignAgreementID`, notifies Michael to send the Clio deposit request.

**Blocked entirely on D11** (vendor choice) — nothing vendor-specific is buildable today. **Recommended stub:** implement the non-vendor-specific field-merging now (build the merged-data object, log/email it to Michael as "here's what would be sent"), so only the actual API call needs to be swapped in once D11 resolves. Design the companion webhook's skeleton now (clientState-style secret validation, per-item-lock-guarded write path — see §7) since it's where the cross-flow concurrency risk originates.

### `Engaged (Accepted)` — gated

Beyond the gate (§3): assign `MatterID`, clone the client folder from `_Template`, generate the timeline from the active playbook, create `Matter Tasks` and calendar events, send the welcome email with the personal timeline.

**Blocked on:** the folder-cloning method is explicitly unproven in `client-pipeline.md` itself (§4.5: "Prove the cloning method before relying on it") — independent of any Michael decision; the `Product Playbooks` list doesn't exist yet; **D15** (calendar restraint) and **D16** (expedited definition) shape timeline-generation details. **Recommended stub:** build the gate and `MatterID`/`EngagementDate` assignment now (no external dependency); stub folder creation behind a feature flag that, when off, writes a placeholder `ClientFolderURL` note and logs to `Pipeline Activity`; stub timeline generation to always treat `Expedited` as `No` and skip calendar-event creation until D15/D16 land; send the welcome email with manually-curated placeholder timeline text.

### `Signing Scheduled`

Confirmation email with product-specific signing requirements, second-payment instructions, T-3/T-1 reminders via a scheduled checker (date-arithmetic against `SigningStart`, same interval-based scheduler as subscription renewal — not a long-lived delayed timer, since a Railway process can restart).

**Blocked on D12** (signing task templates per product) and **D9/D10** (second-payment instructions). **Recommended stub:** build the T-3/T-1 reminder mechanism now with a generic, clearly-marked-temporary placeholder line ("bring valid photo ID; contact the office for signing requirements") pending D12.

### `Signed & Paid`

Thank-you + funding instructions + `05 Funding` tasks + 30/60-day check-ins. Not blocked on any `[D#]` — `Signed & Paid` is inherently Michael-asserted (a stated permanent v1 constraint per §9, not a decision to resolve). Fully buildable once `Matter Tasks` exists.

### `Declined` / `Not a Fit`

Approved close-out template, suppress all nudges. **Blocked on D17** (close-out email templates). **Recommended stub:** implement suppression fully now (reusing the existing `CLOSED_STAGES` constant in `lib/sharepoint.js`); stub the close-out email as a generic, clearly-marked "placeholder copy — D17 pending" message.

## 5. Decisions for Michael

| Decision  | One-line need                                                                                                                         | Blocks                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **D7**    | Define the conflict-check procedure (what "Cleared" means, when it runs)                                                              | The gate's `ConflictCheckStatus` check (§3)                                                 |
| **D8/D9** | Define what "engaged" requires (signed agreement only / + deposit / + conflict check); deposit/final-payment requirements per product | The gate's payment-state check (stubbed); `Signing Scheduled`'s second-payment instructions |
| **D10**   | Clio trust vs. operating account procedure                                                                                            | Prerequisite to answering D8/D9 concretely                                                  |
| **D11**   | E-signature vendor (Adobe Sign vs. DocuSign)                                                                                          | `Fee Agreement Sent`'s actual send action and the entire companion webhook                  |
| **D12**   | Product-specific signing task templates                                                                                               | `Signing Scheduled`'s confirmation-email content (stubbed generic)                          |
| **D15**   | Which milestones belong on the calendar                                                                                               | Timeline-generation's calendar-event step inside `Engaged (Accepted)` (stubbed off)         |
| **D16**   | Expedited-service pricing/SLA definition                                                                                              | Timeline-generation's expedited branch (stubbed to always non-expedited)                    |
| **D17**   | Approved close-out/decline email templates                                                                                            | `Declined`/`Not a Fit` case (stubbed placeholder)                                           |

## 6. Schema gap analysis

Cross-referencing `client-pipeline.md` §4.1's full column list against what's live today (built 2026-07-24: `Stage`, `StageChangedAt`, `PreviousStage`, `ConflictCheckStatus`, `ConflictCheckCompletedAt`, `EngagementDate`, `MatterID`, `AgreementStatus`, `ESignAgreementID`, `FeeQuoted`, `OnboardingSent(At)`, plus the pre-existing trimmed intake columns):

**Add now** — directly read or written by a Flow E case: `RecalculateTimeline`, `TimelineVersion`, `TimelineGeneratedAt`, `ClientFolderURL`, `NextAction`/`NextActionDue`, `IntakeReceived`/`IntakeReceivedAt`, `IntakeNudgeCount`/`LastIntakeNudgeAt`/`AgreementNudgeCount`/`LastAgreementNudgeAt` (Flow G's own fields, but adding them alongside this pass avoids a second migration — Flow E doesn't need to _use_ them, only needs them to exist), `ClosedReason`, `Expedited`/`ExpeditedFeeConfirmed`, `TargetSigningDate`/`SigningStart`/`SigningEnd`/`SigningTimeZone`/`SigningLocation`.

**Recommend dropping (confirm with Michael):** `LastProcessedEventKey` — `client-pipeline.md` §4.1 lists this as a Client Pipeline column, but `Pipeline Activity`'s `EventKey` field already serves as the idempotency signal the stage engine checks. Since `Pipeline Activity` now exists, relying on it exclusively avoids two sources of truth that can drift.

**Defer to Flow F/dashboard phase:** `LastActivityAt` — useful for a "stale matters" digest view, not read or written by any Flow E case.

**Obsolete, superseded by Calendly:** `BookingAppointmentID`, `BookingServiceID` — replaced by `CalendlyEventURI`, already built. Formally strike these when `client-pipeline.md` gets its pending Calendly rewrite.

**Low priority, not read by any Flow E case:** `ConsultLocationType`.

**Defer to the dedicated Clio-boundary/payment phase** (Flow E only _reads_ payment state via the stubbed gate check, doesn't manage the lifecycle): `ClioMatterID`, `DepositStatus`, `DepositRequestedAt`, `DepositPaidAt`, `FinalPaymentStatus`, `FinalPaymentRequestedAt`, `FinalPaymentPaidAt`, `PaymentStatusConfirmedBy`, `PaymentStatusConfirmedAt`. Which of these the gate should eventually read is itself gated on D8/D9 — adding the full group now risks guessing at a schema before the decision that defines its meaning (the same reasoning the Calendly design doc applied to defer this exact group once already).

**Defer, not referenced by any Flow E case:** `JointClientFirstName`, `JointClientLastName`, `PreferredContactMethod`, `AlternateEmail`, `InternetMessageID`, `ReferralSource`, `FileRequestURL`, `FileRequestClosedAt` (blocked on D14 and gap G7, unrelated to Flow E).

## 7. Cross-flow concurrency risk

Flow E's own trigger only serializes against itself (§2.2). Nothing in `client-pipeline.md` — written assuming isolated Power Automate flows with their own trigger isolation — addresses what happens when the same item is written by Flow E's own stage-transition handling, the not-yet-built Flow G nudge scheduler (incrementing nudge counters), and the e-sign vendor's "agreement completed" webhook (writing `AgreementStatus`/`ESignAgreementID` — fields the engagement gate reads directly).

Since all of this now lives in **one process** (unlike the original multi-flow design), the mitigation is architectural:

1. **Route every write to a `Client Pipeline` item through the same per-item lock** (`lib/pipelineItemLock.js`) — not just within `stageEngine.js`, but also from `pipeline-sync.js`'s existing writes, the future e-sign-completion webhook handler, and the future Flow G scheduler. As long as everything runs in this one Node process, a shared lock keyed by item ID genuinely serializes all writers.
2. **Add Graph ETag-based optimistic concurrency to `lib/sharepoint.js`'s `updatePipelineItem`**, which today does a plain PATCH with no precondition check. Passing `If-Match: <etag>` causes Graph to reject with `412 Precondition Failed` if the item changed since the caller last read it — catching what the in-process lock can't: Michael editing the item directly in the SharePoint UI, or a second process writing concurrently if Railway is ever scaled beyond one instance. Recommend a read-modify-write retry loop on `412` (re-fetch, re-apply, retry once or twice, then fall through to the standard error/notify path).
3. The e-sign companion webhook must acquire the same per-item lock before writing `AgreementStatus`/`ESignAgreementID`, so it can't race a concurrent `Fee Agreement Sent`-triggered notification for the same item, and the engagement gate never observes a half-written state.

## 8. Recommended build phases (Flow E only)

| Phase | Contents                                                                                                                                                                                                                                                                                                                                                                    | Exit criterion                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Subscription infra (`lib/subscriptions.js`, validation handshake, renewal check), `Pipeline Activity` client + `EventKey` idempotency skeleton, per-item lock, fast-ack handler wired into `server.js`; simplest case only — `Consult Held` (reminder task, questionnaire-send stubbed). Also: wire `webhook-server`'s existing `npm test` into `.github/workflows/ci.yml`. | A real `Stage` edit reliably triggers exactly one `Consult Held` run, produces exactly one `Pipeline Activity` success record, does not re-trigger itself; `npm test` runs in CI and blocks merge on failure.         |
| 2     | Engagement gate (payment-state stubbed); `MatterID`/`EngagementDate` assignment; folder creation and timeline generation behind feature-flag/manual-override stubs.                                                                                                                                                                                                         | Every gate check that has a defined column is enforced and unit-tested for both pass and revert-with-notification paths; folder/timeline stubs log clearly as placeholders.                                           |
| 3     | Fee-agreement e-sign integration — blocked on D11; field-merging/placeholder-notification half of `Fee Agreement Sent`, plus the companion webhook's skeleton (secret validation, per-item-lock-guarded write path), buildable now.                                                                                                                                         | Once D11 lands, wiring the real vendor call is the only remaining work.                                                                                                                                               |
| 4     | Signing-stage reminders (T-3/T-1 scheduler, generic content pending D12) and funding follow-up (`Signed & Paid`, fully buildable).                                                                                                                                                                                                                                          | Every stage handled by Flow E is idempotent (re-running a processed `eventKey` no-ops) and recoverable (a partial failure can be safely retried without duplicating tasks, calendar events, or client-facing emails). |

## 9. Testing approach

New `.test.js` files in `lib/`, following the existing `node:test` + fake-client-with-recorded-`calls` convention (`sharepoint.test.js`, `server.test.js`). Unlike the existing suite, these must actually run in CI (Phase 1 fixes this as its own exit-criterion item).

- **Stage engine double-event** — call `processStageChange` twice with the same item fields (same `eventKey`); assert the second call is a no-op against a fake `pipelineActivityClient` reporting the key as already present, and no write functions on the fake `sharepointClient` are called a second time.
- **Two rapid edits** — exercise `lib/pipelineItemLock.js` directly: fire two concurrent `withItemLock(id, fn)` calls for the same id and assert they resolve strictly in sequence.
- **Self-update** — feed the dispatcher an item where `fields.Stage === fields.PreviousStage`; assert no case handler runs at all. The single most important new test given it's a new mechanism with no source-doc precedent.
- **Partial failure after task creation / after calendar creation** — inject a fake dependency that succeeds on an early sub-step and throws on a later one; assert `recordActivity` is called with `Outcome: "Failed"` and never `"Success"` for that `eventKey`.
- **Recalculation preserving completed tasks** (Phase 2+) — re-running generation with an incremented `TimelineVersion` doesn't touch tasks already marked done.
- **Closed matters receive no nudges** — the closed-stage set (reusing `CLOSED_STAGES` from `lib/sharepoint.js`) correctly excludes closed items from whatever suppression check the `Declined`/`Not a Fit` case sets.
- **Graph subscription validation handshake** — a request with `?validationToken=xyz` gets back `text/plain` `xyz` with no Graph calls made.
- **`clientState` rejection** — a notification batch with a wrong/missing `clientState` is rejected (401) before any delta fetch, mirroring the existing `validateCalendlySignature` rejection test pattern.

## Out of scope (deferred to follow-up specs)

- Flow F (daily digest) and Flow G (nudge scheduler) themselves — only their concurrency interaction with Flow E is addressed here (§7).
- The actual Clio integration (§9 of `client-pipeline.md` keeps this manual for v1).
- Resolving any of the D7/D8/D9/D10/D11/D12/D15/D16/D17 decisions themselves — this document only identifies what each blocks.
- Updating `client-pipeline.md` to reflect the Calendly-not-Bookings reality and the schema already built — a separate documentation pass.
- `Product Playbooks` and `Matter Tasks` list schemas — needed by Phase 2+ but not designed here; a follow-up spec should cover them before Phase 2 starts.
