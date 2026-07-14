# External Webhooks & CI/CD Status Notifications

This document provides setup instructions for configuring deployment status notifications via GitHub Actions and integrating Tally contact form submissions with external services (such as Relay.app, Zapier, Clio, and Slack).

---

## Table of Contents

1. [GitHub Actions CI/CD Deployment Notifications](#1-github-actions-cicd-deployment-notifications)
   - [Workflow Details](#workflow-details)
   - [Payload Structure](#payload-structure)
   - [Configuring the DEPLOY_WEBHOOK_URL Secret](#configuring-the-deploy_webhook_url-secret)
2. [Tally Contact Form Webhook Integration](#2-tally-contact-form-webhook-integration)
   - [Form Implementation](#form-implementation)
   - [Configuring Tally Webhooks](#configuring-tally-webhooks)
   - [Integrating with Relay.app (preferred)](#integrating-with-relayapp-preferred)
   - [Integrating with Zapier](#integrating-with-zapier)
   - [Connecting to Clio (Legal CRM)](#connecting-to-clio-legal-crm)
   - [Setting up Slack Notifications](#setting-up-slack-notifications)

---

## 1. GitHub Actions CI/CD Deployment Notifications

The GitHub Actions workflow defined in [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) automatically compiles the static site using Vite and deploys the files to the Bluehost server via FTPS on every push to the `main` branch.

To provide real-time updates of the build and deployment pipeline, we have configured custom post-deployment steps that trigger a webhook notification on both success and failure events.

### Workflow Details

The workflow checks for the presence of the `DEPLOY_WEBHOOK_URL` repository secret. If it is configured, a payload containing build and commit details is POSTed to the webhook endpoint using `curl`.

- **Success Notification Step:** Runs only if all preceding build and deployment steps succeed.
- **Failure Notification Step:** Runs if any build or deployment step fails.

### Payload Structure

The webhook payload is sent in JSON format (`Content-Type: application/json`). Below is an example payload:

```json
{
  "status": "success",
  "repository": "owner/repository-name",
  "branch": "main",
  "run_id": "1234567890",
  "run_url": "https://github.com/owner/repository-name/actions/runs/1234567890",
  "actor": "github-username",
  "commit": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
  "commit_message": "feat: update legal practice area services"
}
```

> [!NOTE]
> If the workflow is run manually via `workflow_dispatch`, the `commit_message` will default to `"Triggered manually or no head commit info"`.

### Configuring the DEPLOY_WEBHOOK_URL Secret

To activate these notifications, follow these steps to add the secret to your GitHub repository:

1. **Generate your webhook URL:**
   - **Slack:** Set up an _Incoming Webhook_ app in your workspace and copy the URL.
   - **Discord:** Go to Channel Settings > Integrations > Webhooks, create a new webhook, and copy the URL.
   - **Zapier / Make:** Create a webhook trigger (e.g., "Webhooks by Zapier" with the "Catch Hook" trigger) and copy the URL.
2. **Access your GitHub repository:**
   - Go to your repository page on GitHub.
3. **Navigate to Secrets:**
   - Click on the **Settings** tab.
   - In the left sidebar, expand **Secrets and variables** and click **Actions**.
4. **Create the Secret:**
   - Click the **New repository secret** button.
   - **Name:** `DEPLOY_WEBHOOK_URL`
   - **Value:** Paste the webhook URL you copied in Step 1.
5. **Save:**
   - Click **Add secret**. Subsequent workflow runs will now trigger notifications to this endpoint.

---

## 2. Tally Contact Form Webhook Integration

The contact page embeds a [Tally](https://tally.so) form to capture client inquiries without requiring a backend server. Tally delivers each submission as structured JSON to any webhook endpoint — webhooks are included on Tally's free plan.

### Form Implementation

The frontend embeds Tally form **`ob17lb`** as an iframe in [public/contact.html](../public/contact.html), loaded by [public/js/tally-embed.js](../public/js/tally-embed.js). The standalone intake questionnaire is Tally form **`q4MKYO`**. The canonical field contract (field names, hidden fields, and the service-label-to-product-code mapping) lives in [docs/client-pipeline.md §3](./client-pipeline.md) and [public/js/product-contract.json](../public/js/product-contract.json) — read it before changing form fields or building consumers.

### Configuring Tally Webhooks

1. Log in to the [Tally dashboard](https://tally.so/) and open the form (`ob17lb` for the contact form, `q4MKYO` for the questionnaire).
2. Go to **Integrations → Webhooks** and click **Connect**.
3. Paste the destination URL (a Relay.app webhook trigger, Power Automate endpoint, or Zapier catch hook) and save.
4. Submit a test entry; the endpoint receives a JSON payload with a `data.fields` array (one entry per question, keyed by label) plus `submissionId` — use `submissionId` for idempotency, and validate the hidden `form_source` field before processing.

### Integrating with Relay.app (preferred)

Relay.app has a **native Tally trigger**, so no webhook plumbing is needed:

1. In Relay.app, create a workflow with the trigger **Tally → New form submission** and connect the Tally account.
2. Select the form (`ob17lb`), then map fields per the intake flow spec (Flow D) in [docs/client-pipeline.md](./client-pipeline.md): validate `form_source`, map `Service needed` → `product_code` via the contract table, and create/update the SharePoint pipeline row.

### Integrating with Zapier

1. Create a Zap with **Webhooks by Zapier → Catch Hook** and copy the webhook URL, or use Zapier's native **Tally** trigger.
2. If using the catch hook, paste the URL into the form's **Integrations → Webhooks** in Tally.
3. Test by submitting the form; the payload contains the fields `First name`, `Last name`, `Email`, `Phone`, `Service needed`, `Message`, plus the hidden `form_source`, `contract_version`, and `page` fields.

### Connecting to Clio (Legal CRM)

1. **Prerequisites:** a Clio account and a Zapier or Relay.app workflow triggered by the Tally form (above).
2. Add a **Clio** (or **Clio Grow**) action — e.g., **Create Person Contact** or **Create Lead** — and authenticate.
3. Map the Tally fields to Clio:
   - `First Name` → `First name`
   - `Last Name` → `Last name`
   - `Email Address` → `Email`
   - `Phone Number` → `Phone`
   - `Description / Details` → `Message` (and `Service needed` for the matter type)
4. Test, then enable. Note the system-of-record split in [docs/client-pipeline.md §9](./client-pipeline.md): the SharePoint list is the operational pipeline; Clio is billing and trust accounting.

### Setting up Slack Notifications

Tally has a native Slack integration: in the form's **Integrations** tab, connect **Slack**, choose the channel, and each submission posts a summary. For Discord or richer formatting, route through the Relay.app/Zapier workflow instead.

> [!NOTE]
> The previous Web3Forms integration is retired. If the old Web3Forms access key is still active in its dashboard, revoke it — the form no longer references it, but the key itself remains usable server-side until revoked.
