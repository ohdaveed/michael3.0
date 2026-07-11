# External Webhooks & CI/CD Status Notifications

This document provides setup instructions for configuring deployment status notifications via GitHub Actions and integrating contact form submissions with external services (such as Zapier, Clio, Slack, and Discord) using Web3Forms.

---

## Table of Contents

1. [GitHub Actions CI/CD Deployment Notifications](#1-github-actions-cicd-deployment-notifications)
   - [Workflow Details](#workflow-details)
   - [Payload Structure](#payload-structure)
   - [Configuring the DEPLOY_WEBHOOK_URL Secret](#configuring-the-deploy_webhook_url-secret)
2. [Web3Forms Contact Form Webhook Integration](#2-web3forms-contact-form-webhook-integration)
   - [Form Implementation](#form-implementation)
   - [Configuring Web3Forms Webhooks](#configuring-web3forms-webhooks)
   - [Integrating with Zapier](#integrating-with-zapier)
   - [Connecting to Clio (Legal CRM)](#connecting-to-clio-legal-crm)
   - [Setting up Slack / Discord Notifications](#setting-up-slack--discord-notifications)

---

## 1. GitHub Actions CI/CD Deployment Notifications

The GitHub Actions workflow defined in [.github/workflows/deploy.yml](file:///home/parallax/projects/michael3.0/.github/workflows/deploy.yml) automatically compiles the static site using Vite and deploys the files to the Bluehost server via FTPS on every push to the `main` branch.

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

## 2. Web3Forms Contact Form Webhook Integration

The contact page uses Web3Forms to capture client inquiries without requiring a backend server. Web3Forms is highly extensible and allows you to forward form submissions to third-party APIs, CRMs, and messaging apps.

### Form Implementation

The frontend form is defined in [public/contact.html](file:///home/parallax/projects/michael3.0/public/contact.html). It submits data directly to the Web3Forms endpoint:

```html
<form
  id="contactForm"
  class="contact-form"
  action="https://api.web3forms.com/submit"
  method="POST"
  novalidate
>
  <input type="hidden" name="access_key" value="YOUR_ACCESS_KEY" />
  <!-- Form fields (first_name, last_name, email, phone, message) -->
</form>
```

### Configuring Web3Forms Webhooks

> [!IMPORTANT]
> Webhooks and native integrations (such as Slack/Discord routing) within Web3Forms typically require a **Web3Forms Pro** subscription.

To configure webhooks in Web3Forms:

1. Log in to your [Web3Forms Dashboard](https://web3forms.com/).
2. Locate the form matching your `access_key` (configured in [public/contact.html](file:///home/parallax/projects/michael3.0/public/contact.html)).
3. Click on the **Integrations** tab or the form settings page.
4. Locate the **Webhook** card, toggle it **ON**, and input the destination URL (e.g., your Zapier webhook endpoint).

---

### Integrating with Zapier

To connect Web3Forms to thousands of third-party applications, use Zapier's webhook integration:

1. **Create a Zap:**
   - Log in to your [Zapier Dashboard](https://zapier.com/) and click **Create Zap**.
2. **Set up the Trigger:**
   - Search for and select **Webhooks by Zapier**.
   - Choose **Catch Hook** as the Event. Click **Continue**.
   - Copy the custom **Webhook URL** provided by Zapier.
3. **Connect to Web3Forms:**
   - Paste this URL into the **Webhook** integration input field on your Web3Forms dashboard and click save.
4. **Test the Trigger:**
   - Go to the contact page of your live site (or submit a test locally), fill out the form, and submit it.
   - In Zapier, click **Test trigger**. You should see the form fields (`first_name`, `last_name`, `email`, `phone`, `message`) in the test data payload.

---

### Connecting to Clio (Legal CRM)

Clio is a leading legal practice management CRM. Connecting your web form submissions directly to Clio helps automate client intake.

1. **Prerequisites:**
   - A Clio account.
   - A Zapier account (using the webhook trigger set up in the section above).
2. **Add an Action in Zapier:**
   - Inside your Zap, click the **Action** step.
   - Search for **Clio** (or **Clio Grow** depending on which module you use for client intake).
3. **Authenticate Clio:**
   - Choose the Action Event (e.g., **Create Person Contact** or **Create Lead**).
   - Log in and authorize Zapier to access your Clio account.
4. **Map Form Fields:**
   - Map the fields from the Web3Forms webhook payload to the Clio fields:
     - `First Name` &rarr; `first_name`
     - `Last Name` &rarr; `last_name`
     - `Email Address` &rarr; `email`
     - `Phone Number` &rarr; `phone`
     - `Description / Details` &rarr; `message`
5. **Test and Enable:**
   - Test the step to verify that a contact/lead is successfully created in Clio.
   - Turn on the Zap to automate lead ingestion from that point forward.

---

### Setting up Slack / Discord Notifications

If you want direct team notifications when a contact form is submitted, Web3Forms provides native Slack and Discord integrations:

#### Native Slack Integration

1. Configure an **Incoming Webhook** in your Slack Workspace settings.
2. Select the target channel and copy the webhook URL.
3. Go to the Web3Forms dashboard for your access key, click **Integrations**, toggle **Slack** to ON, and paste the URL.

#### Native Discord Integration

1. In your Discord server, open channel settings for the desired channel, click **Integrations**, then select **Create Webhook**.
2. Copy the webhook URL.
3. In the Web3Forms dashboard, click **Integrations**, toggle **Discord** to ON, and paste the URL.
