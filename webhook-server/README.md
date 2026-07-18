# Lehr Law — Webhook Server

Receives Tally contact form submissions and Calendly booking events. Validates
each payload, sends Michael an email notification, and optionally forwards
structured JSON to a downstream URL (Power Automate, Relay.app, Zapier, etc.).

---

## Endpoints

| Method | Path                 | Description                                 |
| ------ | -------------------- | ------------------------------------------- |
| GET    | `/`                  | Health check                                |
| POST   | `/webhooks/tally`    | Tally form submission                       |
| POST   | `/webhooks/calendly` | Calendly invitee.created / invitee.canceled |

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
SMTP_HOST             smtp.office365.com
SMTP_PORT             587
SMTP_USER             michael@lehr-law.com
SMTP_PASS             <Outlook app password>
SMTP_FROM             michael@lehr-law.com
CALENDLY_WEBHOOK_SIGNING_KEY   <from Calendly — see below>
TALLY_FORM_ID         ob17lb
DOWNSTREAM_URL        (leave blank for now, or paste a Power Automate URL)
```

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

## Outlook SMTP — App Password setup

Microsoft 365 / Outlook.com require an **App Password** (not your account
password) when basic SMTP auth is used without OAuth.

1. Go to [account.microsoft.com/security](https://account.microsoft.com/security).
2. Under **Advanced security options**, click **App passwords**.
3. Click **Create a new app password** and copy the generated password.
4. Set `SMTP_PASS` to that value in Railway.

If the Microsoft 365 tenant has **basic auth disabled** (common in business
tenants), ask the M365 administrator to enable SMTP AUTH for `michael@lehr-law.com`
or switch `SMTP_HOST` to a transactional sender (SendGrid, Resend, etc.).

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
