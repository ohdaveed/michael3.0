"use strict";

const { createGraphClient } = require("./graph-client");

// Sends mail via Microsoft Graph's /users/{mailbox}/sendMail, using the same
// client-credentials Graph client as the SharePoint sync. Replaces SMTP AUTH
// (nodemailer), which Microsoft 365 Security Defaults blocks outright for
// Basic Auth — Graph's OAuth2 app-only flow isn't affected by that policy.
function createMailer({ graphClient = createGraphClient(), fromMailbox } = {}) {
  async function sendEmail({ to, subject, text, html }) {
    try {
      await graphClient.graphFetch(
        `/users/${encodeURIComponent(fromMailbox)}/sendMail`,
        {
          method: "POST",
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: "HTML", content: html || text },
              toRecipients: [{ emailAddress: { address: to } }],
            },
            saveToSentItems: false,
          }),
        },
      );
      console.log(`[email] Sent: ${subject}`);
    } catch (err) {
      console.error("[email] Send failed:", err.message);
    }
  }

  return { sendEmail };
}

module.exports = { createMailer };
