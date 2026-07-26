# Lehr Law — Webhook Server

Receives Tally contact form submissions and Calendly booking events. Validates
each payload, sends Michael an email notification, and optionally forwards
structured JSON to a downstream URL (Power Automate, Relay.app, Zapier, etc.).

---

## Endpoints

| Method | Path                       | Description                                                                |
| ------ | -------------------------- | -------------------------------------------------------------------------- |
| GET    | `/`                        | Health check                                                               |
| POST   | `/webhooks/tally`          | Tally form submission                                                      |
| POST   | `/webhooks/calendly`       | Calendly invitee.created / invitee.canceled                                |
| POST   | `/webhooks/graph-pipeline` | Microsoft Graph change notifications for the Client Pipeline list (Flow E) |

- `POST /webhooks/graph-pipeline` — Microsoft Graph change notifications
  for the SharePoint Client Pipeline list (Flow E stage engine). Handles
  the subscription validation handshake (`?validationToken=...`) and
  rejects any notification whose `clientState` doesn't match
  `GRAPH_SUBSCRIPTION_CLIENT_STATE`.

---

## Deploy to Railway (free tier)

Railway gives you a persistent Node.js server with a public HTTPS URL on the
free tier — no credit card required for low-traffic use.

### 1. Create a Railway project

```bash
# Install Railway CLI (once)
npm install -g @railway/cli

# Log in
railway login

# From the webhook-server/ directory:
railway init          # creates a new project
railway up            # deploys the server
```

Alternatively, go to [railway.app](https://railway.app), click **New Project →
Deploy from GitHub repo**, point it at `ohdaveed/michael3.0`, and set the
**Root directory** to `webhook-server/`.

### 2. Set environment variables in Railway

In the Railway dashboard → your project → **Variables**, add:

```
MICHAEL_EMAIL         michael@lehr-law.com
CALENDLY_WEBHOOK_SIGNING_KEY   <from Calendly — see below>
TALLY_FORM_ID         ob17lb
DOWNSTREAM_URL        (leave blank for now, or paste a Power Automate URL)
LEAD_ACK_ENABLED      (leave unset until the acknowledgment copy is approved)
BOOKING_URL           (optional — defaults to the Calendly consultation page)
```

**Lead acknowledgment email.** When `LEAD_ACK_ENABLED=true`, every valid
Tally contact-form submission also sends the lead an acknowledgment from
`MICHAEL_EMAIL` — "received, here's what happens next" with links to the
what-to-expect page and the booking page (`BOOKING_URL`; keep it in sync
with `public/js/booking-url.js` if overridden). This is Flow D step 5 of
`docs/client-pipeline.md`. It ships **disabled** because the template copy
in `lib/lead-ack.js` needs Michael's approval (decision **[D17]**) before
it goes in front of prospects — flip the variable on in Railway once he
signs off. Rejected payloads (unknown form, bad `form_source`) never get
an acknowledgment, and a failed acknowledgment send never blocks Michael's
own notification.

(The `GRAPH_*`/`SHAREPOINT_*` variables that power both the SharePoint sync
and email sending are set up in the "SharePoint Client Pipeline sync"
section below.)

Railway automatically sets `PORT`. Do not override it.

### 3. Get your public URL

Railway assigns a URL like `https://lehr-law-webhook-server.up.railway.app`.
Find it in the project dashboard under **Deployments → Domain**.

Test it:

```bash
curl https://<your-railway-url>/
# → {"ok":true,"service":"lehr-law-webhook-server","ts":"..."}
```

---

## Configure Calendly webhooks

1. Log in to [calendly.com](https://calendly.com) and go to
   **Integrations → Webhooks** (requires Calendly Standard or higher).
2. Click **New Webhook**.
3. Paste your Railway URL + `/webhooks/calendly`:
   ```
   https://<your-railway-url>/webhooks/calendly
   ```
4. Select events: **invitee.created** and **invitee.canceled**.
5. Click **Create webhook**. Copy the **Signing key** shown after creation.
6. In Railway, set `CALENDLY_WEBHOOK_SIGNING_KEY` to that value and redeploy.

> **Note:** Calendly webhooks require Standard plan ($10/mo) or above.
> On the free plan, use Calendly's built-in email notifications to Michael's
> Outlook instead and skip this integration.

---

## SharePoint Client Pipeline sync + email notifications

Every Tally message and Calendly booking/cancellation is upserted into a
SharePoint list called `Client Pipeline`, and email notifications to Michael
are sent, both via Microsoft Graph, using a single Azure AD app registration.
Email goes through Graph's `/sendMail` API rather than SMTP because this
tenant's Security Defaults policy blocks Basic Auth SMTP outright — Graph's
app-only OAuth2 flow isn't subject to that restriction.

### 1. Create the SharePoint site and list

1. In the Microsoft 365 admin center, create a new **private** SharePoint
   site named "Lehr Law Practice". Restrict membership to Michael (and any
   future admin); enforce MFA for all members; enable audit logging.
2. In that site, create a list named `Client Pipeline` with these columns
   (all single line of text unless noted):
   - `Title` (built in)
   - `LeadID`, `FirstName`, `LastName`, `Email`, `Phone`
   - `Source` (choice: Website Message / Booking)
   - `DesiredProductCode`, `DesiredProductLabel`
   - `TallySubmissionID`, `CalendlyEventURI`
   - `InquiryReceivedAt` (date and time)
   - `Stage` (single line of text — values used by the sync: `New Inquiry`,
     `Consult Scheduled`, `Consult Cancelled`)
   - `ConsultStart`, `ConsultEnd` (date and time), `ConsultTimeZone`
   - `Notes` (multiple lines of text)
3. **Index the `Email` and `CalendlyEventURI` columns** (List settings →
   Indexed columns) — Graph's `$filter` on these fields requires it for
   reliable results at scale.
4. Enable list **versioning** (List settings → Versioning settings) — this
   is the audit trail for this phase (no separate `Pipeline Activity` list
   yet).

### 2. Register the Azure AD app

1. In the Entra admin center → **App registrations** → **New registration**.
   Name it something identifiable, e.g. "Lehr Law Webhook Server".
2. Under **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** → search for and add both `Sites.Selected`
   and `Mail.Send`. An admin must grant consent for both.
3. `Mail.Send` allows the app to send mail as _any_ mailbox in the tenant
   by default — restrict it to `michael@lehr-law.com` only via an Exchange
   **application access policy** (Exchange Online PowerShell:
   `New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId
michael@lehr-law.com -AccessRight RestrictAccess -Description "Webhook
server — Michael's mailbox only"`). Without this, the app's blast radius
   if the client secret ever leaks extends to every mailbox in the tenant.
4. Under **Certificates & secrets** → **New client secret**. **Set an
   expiration of 12 months or less** — do not create a secret with no
   expiration. Record the secret value immediately; it's shown only once.
5. Record the **Application (client) ID** and **Directory (tenant) ID**
   from the app's Overview page.

### 3. Grant the app access to only the new site (Sites.Selected)

`Sites.Selected` grants zero site access by default — you must explicitly
grant this app permission to the one site it needs, using Graph Explorer or
a one-off authenticated request as a tenant admin:

```http
POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
Content-Type: application/json

{
  "roles": ["write"],
  "grantedToIdentities": [{
    "application": {
      "id": "{app-client-id}",
      "displayName": "Lehr Law Webhook Server"
    }
  }]
}
```

Find `{site-id}` via `GET https://graph.microsoft.com/v1.0/sites/{tenant}.sharepoint.com:/sites/{site-name}`.
Find `{list-id}` via `GET https://graph.microsoft.com/v1.0/sites/{site-id}/lists`.

### 4. Set the Railway environment variables

In the Railway dashboard → your project → **Variables**, add the five
`GRAPH_*`/`SHAREPOINT_*` values from `.env.example` above, using the
tenant ID, client ID, client secret, site ID, and list ID from steps 2–3.

```
# Flow E — stage engine (Graph change notifications)

GRAPH_NOTIFICATION_URL=https://<your-railway-url>/webhooks/graph-pipeline
GRAPH_SUBSCRIPTION_CLIENT_STATE=<long random string — rotate like CALENDLY_WEBHOOK_SIGNING_KEY>
SHAREPOINT_ACTIVITY_LIST_ID=<list id of the Pipeline Activity list>
```

### 5. Rotation reminder

Set a calendar reminder for one month before the client secret's expiration
to generate a new one (Certificates & secrets → New client secret → update
`GRAPH_CLIENT_SECRET` in Railway → delete the old secret from the app
registration).

### Flow E deploy checklist

0. Backfill `PreviousStage = Stage` on ALL existing Client Pipeline items
   before setting the Flow E env vars below. The engine's first delta call
   is a full baseline of every list item; any historical item whose
   `Stage` doesn't already equal `PreviousStage` (e.g. one manually
   sitting in "Consult Held") would otherwise look like a fresh transition
   on day one — emailing Michael and writing ledger rows for matters
   handled long ago. Do a one-time bulk edit (SharePoint grid view, or a
   Graph `PATCH` per item) to set `PreviousStage` equal to the current
   `Stage` everywhere first.
1. Confirm the `Pipeline Activity` list's internal column names match
   `lib/pipeline-activity.js` `FIELDS` (`EventKey`, `EventType`,
   `EventSource`, `EventTimestamp`, `ActorOrFlow`, `Summary`, `Outcome`,
   `ErrorDetails`, `PipelineItemID`):
   `GET https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{activity-list-id}/columns`
   — fix `FIELDS` (one place) if any differ, and add any missing columns
   (e.g. `PipelineItemID` as a single-line-of-text column) to the list.
   Also create an index on the `EventKey` column — the engine's
   idempotency lookup uses a non-indexed `$filter` that SharePoint may
   start rejecting once the list passes the ~5,000-item view threshold.
2. Set the three env vars above in Railway and redeploy.
3. Watch the boot log for `[subscriptions] {"action":"created",...}` —
   the validation handshake fails (and subscription creation errors) if
   the deployed URL isn't reachable over HTTPS. If the boot log shows
   `{"action":"created",...}` on EVERY restart instead of settling into
   `checked`/`ok`, Graph is echoing the subscription resource string in a
   different format than `sites/{site-id}/lists/{list-id}` and the
   resource filter in `lib/subscriptions.js` needs adjusting — otherwise
   duplicate subscriptions will accumulate.
4. Test end-to-end: move a test item's `Stage` to `Consult Held` in the
   SharePoint UI; expect exactly one reminder email, one success row in
   `Pipeline Activity`, and `PreviousStage`/`StageChangedAt` set on the
   item — and no repeat when the item is touched again.

---

## Configure Tally webhooks

1. Log in to [tally.so](https://tally.so) and open form **ob17lb**
   (the contact form).
2. Go to **Integrations → Webhooks → Connect**.
3. Paste your Railway URL + `/webhooks/tally`:
   ```
   https://<your-railway-url>/webhooks/tally
   ```
4. Save and click **Test webhook**. You should see a `200 ok` response and
   an email arrive at Michael's inbox.

Tally webhooks are available on the free plan.

---

## Optional: forward to Power Automate or Relay.app

Set `DOWNSTREAM_URL` to any HTTP endpoint that accepts POST with
`Content-Type: application/json`. The server sends a clean, flat JSON object:

**Tally payload:**

```json
{
  "source": "tally",
  "submissionId": "abc123",
  "formId": "ob17lb",
  "contractVersion": "2",
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@example.com",
  "phone": "415-555-0100",
  "service": "Complete Living Trust Package",
  "message": "...",
  "page": "contact",
  "receivedAt": "2026-07-18T04:00:00.000Z"
}
```

**Calendly booking payload:**

```json
{
  "source": "calendly",
  "eventType": "booking.created",
  "name": "Jane Smith",
  "email": "jane@example.com",
  "eventName": "Estate Planning Consultation",
  "startTime": "2026-07-25T14:00:00.000Z",
  "endTime": "2026-07-25T14:30:00.000Z",
  "questionsAndAnswers": [],
  "cancelUrl": "https://calendly.com/cancellations/...",
  "rescheduleUrl": "https://calendly.com/reschedulings/...",
  "receivedAt": "2026-07-18T04:00:00.000Z"
}
```

**Calendly cancellation payload:**

```json
{
  "source": "calendly",
  "eventType": "booking.canceled",
  "name": "Jane Smith",
  "email": "jane@example.com",
  "eventName": "Estate Planning Consultation",
  "startTime": "2026-07-25T14:00:00.000Z",
  "cancellationReason": "scheduling conflict",
  "receivedAt": "2026-07-18T04:00:00.000Z"
}
```

For **Relay.app**: create an HTTP trigger workflow, paste the trigger URL as
`DOWNSTREAM_URL`, then map the fields to your SharePoint pipeline actions.

For **Power Automate HTTP trigger**: requires Premium connector license. Set
the trigger URL as `DOWNSTREAM_URL`.

---

## Local development

```bash
cd webhook-server
npm install
cp .env.example .env    # fill in your values
npm run dev             # node --watch server.js
```

Test with curl:

```bash
# Tally test submission
curl -X POST http://localhost:3000/webhooks/tally \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "submissionId": "test-001",
      "formId": "ob17lb",
      "fields": [
        {"label": "First name", "value": "Jane"},
        {"label": "Last name", "value": "Smith"},
        {"label": "Email", "value": "jane@example.com"},
        {"label": "Phone", "value": "415-555-0100"},
        {"label": "Service needed", "value": "Complete Living Trust Package"},
        {"label": "Message", "value": "Test message."},
        {"label": "form_source", "value": "lehr-law-contact"},
        {"label": "contract_version", "value": "2"},
        {"label": "page", "value": "contact"}
      ]
    }
  }'
```
