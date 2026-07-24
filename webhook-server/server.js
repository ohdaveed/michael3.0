// Lehr Law — Webhook Server
// Receives Tally contact form submissions and Calendly booking events,
// validates payloads, emails Michael, optionally forwards to a downstream
// URL, and syncs prospective-matter data into the SharePoint Client
// Pipeline list via Microsoft Graph.
//
// Deploy to Railway (railway.app) — see README.md for full setup.

"use strict";

const crypto = require("crypto");
const express = require("express");
const { createGraphClient } = require("./lib/graph-client");
const { createSharepointClient } = require("./lib/sharepoint");
const { createPipelineSync } = require("./lib/pipeline-sync");
const { createMailer } = require("./lib/mailer");

// ---------------------------------------------------------------------------
// Config — all values come from environment variables (set in Railway)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const MICHAEL_EMAIL = process.env.MICHAEL_EMAIL || "michael@lehr-law.com";
const CALENDLY_SIGNING_KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY || "";
// Optional: POST a structured JSON summary to a second destination
// (Power Automate HTTP trigger, Relay.app, Zapier catch-hook, etc.)
const DOWNSTREAM_URL = process.env.DOWNSTREAM_URL || "";
const TALLY_FORM_ID = process.env.TALLY_FORM_ID || "ob17lb";

// ---------------------------------------------------------------------------
// Downstream forwarding (optional)
// ---------------------------------------------------------------------------
async function forwardDownstream(payload) {
  if (!DOWNSTREAM_URL) return;
  try {
    const res = await fetch(DOWNSTREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log(`[downstream] ${res.status} ${DOWNSTREAM_URL}`);
  } catch (err) {
    console.error("[downstream] Forward failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// SharePoint pipeline sync — failures here must never fail the webhook
// response (Tally/Calendly both retry on non-2xx). Always catch, log, and
// alert Michael by email; the row can be reconciled manually. Michael's
// existing notification email has already been sent by this point, so no
// data is lost on a sync failure.
// ---------------------------------------------------------------------------
function buildDefaultPipelineSync() {
  const graphClient = createGraphClient();
  const sharepointClient = createSharepointClient({ graphClient });
  return createPipelineSync({ sharepointClient });
}

// Mail is sent via Microsoft Graph (/users/{mailbox}/sendMail) rather than
// SMTP AUTH — this tenant's Security Defaults blocks Basic Auth for SMTP
// outright, and Graph's app-only OAuth2 flow isn't subject to that policy.
// Uses the same Graph app registration as the SharePoint sync (Mail.Send
// application permission).
function buildDefaultMailer() {
  return createMailer({ fromMailbox: MICHAEL_EMAIL });
}

// ---------------------------------------------------------------------------
// Calendly HMAC-SHA256 signature validation
// Calendly sends: t=<timestamp>,v1=<sig> in the
// Calendly-Webhook-Signature header.
// ---------------------------------------------------------------------------
function validateCalendlySignature(req) {
  if (!CALENDLY_SIGNING_KEY) return true; // skip if key not configured
  const header = req.headers["calendly-webhook-signature"] || "";
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2)),
  );
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expectedSig = crypto
    .createHmac("sha256", CALENDLY_SIGNING_KEY)
    .update(`${timestamp}.${req.rawBody}`)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSig, "hex"),
  );
}

// ---------------------------------------------------------------------------
// App factory — accepts injectable deps so tests can pass a fake
// pipelineSync/mailer instead of hitting real Graph/SharePoint/Mail.
// ---------------------------------------------------------------------------
function createApp({
  pipelineSync = buildDefaultPipelineSync(),
  mailer = buildDefaultMailer(),
} = {}) {
  const app = express();

  async function syncPipelineSafely(fn, contextLabel) {
    try {
      const result = await fn();
      console.log(
        `[pipeline] ${contextLabel}: ${result.action} (item ${result.itemId || "n/a"})`,
      );
      return result;
    } catch (err) {
      console.error(`[pipeline] ${contextLabel} failed:`, err.message);
      await mailer.sendEmail({
        to: MICHAEL_EMAIL,
        subject: `[ALERT] SharePoint sync failed — ${contextLabel}`,
        text: [
          `SharePoint sync failed for: ${contextLabel}`,
          ``,
          `Error: ${err.message}`,
          ``,
          `Check Railway logs. No data was lost — the email notification for`,
          `this event already sent.`,
        ].join("\n"),
      });
      return { ok: false, error: err.message };
    }
  }

  // Capture rawBody for Calendly HMAC validation before JSON parsing
  app.use((req, res, next) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      req.rawBody = raw;
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch {
        req.body = {};
      }
      next();
    });
  });

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  app.get("/", (req, res) => {
    res.json({ ok: true, service: "lehr-law-webhook-server", ts: new Date() });
  });

  // -------------------------------------------------------------------------
  // POST /webhooks/tally
  // Tally sends: { eventId, createdAt, data: { submissionId, formId, fields[] } }
  // -------------------------------------------------------------------------
  app.post("/webhooks/tally", (req, res) => {
    let submissionId;
    try {
      const body = req.body;
      submissionId = body?.data?.submissionId;
      const formId = body?.data?.formId;

      if (formId !== TALLY_FORM_ID) {
        console.warn(`[tally] Unknown formId: ${formId}`);
        return res.status(400).json({ error: "Unknown form" });
      }

      const fields = {};
      for (const f of body?.data?.fields || []) {
        fields[f.label] = Array.isArray(f.value) ? f.value.join(", ") : f.value;
      }

      if (fields["form_source"] !== "lehr-law-contact") {
        console.warn(
          `[tally] Unexpected form_source: ${fields["form_source"]}`,
        );
        return res.status(400).json({ error: "Invalid form_source" });
      }

      const firstName = fields["First name"] || "";
      const lastName = fields["Last name"] || "";
      const email = fields["Email"] || "";
      const phone = fields["Phone"] || "(not provided)";
      const service = fields["Service needed"] || "(not specified)";
      const message = fields["Message"] || "";
      const page = fields["page"] || "";
      const contractVersion = fields["contract_version"] || "";

      console.log(
        `[tally] Submission ${submissionId} from ${firstName} ${lastName} <${email}>`,
      );

      // Respond immediately — Tally closes the connection ~10s after sending
      // the webhook, well before a SharePoint sync or an email send could
      // complete. Everything below continues in the background; failures
      // there are caught internally (syncPipelineSafely, mailer.sendEmail)
      // and can never turn into an HTTP error after this point.
      res.json({ ok: true, submissionId });

      (async () => {
        const syncResult = await syncPipelineSafely(
          () =>
            pipelineSync.syncTallyMessage({
              submissionId,
              firstName,
              lastName,
              email,
              phone,
              service,
            }),
          `Tally submission ${submissionId} <${email}>`,
        );

        const subjectPrefix =
          syncResult.action === "flagged-multiple" ? "[NEEDS REVIEW] " : "";
        const subject = `${subjectPrefix}New message from ${firstName} ${lastName} — ${service}`;
        const text = [
          `New contact form submission via lehr-law.com`,
          ``,
          `Name:    ${firstName} ${lastName}`,
          `Email:   ${email}`,
          `Phone:   ${phone}`,
          `Service: ${service}`,
          ``,
          `Message:`,
          message,
          ``,
          `---`,
          `Submission ID: ${submissionId}`,
          `Form: ${formId} (contract v${contractVersion}, page: ${page})`,
          `Received: ${new Date().toISOString()}`,
        ].join("\n");

        const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#0b1d33">New contact form submission</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;color:#6b6559;width:100px">Name</td>
        <td style="padding:8px;font-weight:600">${firstName} ${lastName}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${email}">${email}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Phone</td>
        <td style="padding:8px">${phone}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Service</td>
        <td style="padding:8px">${service}</td></tr>
  </table>
  <div style="margin-top:20px;padding:16px;background:#f5f0e8;border-left:3px solid #c5a55a">
    <strong>Message:</strong><br/><br/>
    ${message.replace(/\n/g, "<br/>")}
  </div>
  <p style="margin-top:20px;font-size:12px;color:#9a9088">
    Submission ID: ${submissionId} &middot; Received: ${new Date().toISOString()}
  </p>
</div>`;

        await Promise.all([
          mailer.sendEmail({ to: MICHAEL_EMAIL, subject, text, html }),
          forwardDownstream({
            source: "tally",
            submissionId,
            formId,
            contractVersion,
            firstName,
            lastName,
            email,
            phone,
            service,
            message,
            page,
            receivedAt: new Date().toISOString(),
          }),
        ]);
      })().catch((err) => {
        console.error(
          `[tally] Background processing failed for ${submissionId}:`,
          err,
        );
      });
    } catch (err) {
      console.error("[tally] Handler error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // -------------------------------------------------------------------------
  // POST /webhooks/calendly
  // Calendly sends: { event, created_at, created_by, payload: { uri, event, invitee } }
  // Supported events: invitee.created, invitee.canceled
  // -------------------------------------------------------------------------
  app.post("/webhooks/calendly", (req, res) => {
    let eventType;
    try {
      // Validate HMAC signature
      if (!validateCalendlySignature(req)) {
        console.warn("[calendly] Invalid signature — rejecting");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const body = req.body;
      eventType = body?.event;
      const payload = body?.payload || {};
      const invitee = payload?.invitee || {};
      const event = payload?.event || {};
      // The invitee's own URI is the stable idempotency key — present and
      // unchanged across both invitee.created and invitee.canceled for the
      // same booking.
      const eventUri = payload?.uri || "";

      const name =
        invitee.name ||
        `${invitee.first_name || ""} ${invitee.last_name || ""}`.trim();
      const email = invitee.email || "";
      const startTime = event.start_time
        ? new Date(event.start_time).toLocaleString("en-US", {
            timeZone: "America/Los_Angeles",
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          })
        : "(unknown)";
      const eventName = event.name || "Estate Planning Consultation";
      const cancelUrl = payload?.cancel_url || "";
      const rescheduleUrl = payload?.reschedule_url || "";

      // Questions & answers (custom intake questions from the Calendly form)
      const qas = (payload?.questions_and_answers || [])
        .map((qa) => `${qa.question}: ${qa.answer}`)
        .join("\n");

      console.log(
        `[calendly] ${eventType} — ${name} <${email}> @ ${startTime}`,
      );

      // Respond immediately — the SharePoint sync and email send continue
      // in the background below (see the /webhooks/tally handler for why).
      res.json({ ok: true, event: eventType });

      (async () => {
        if (eventType === "invitee.created") {
          const syncResult = await syncPipelineSafely(
            () =>
              pipelineSync.syncCalendlyBooking({
                eventUri,
                name,
                email,
                startTime: event.start_time,
                endTime: event.end_time,
                timeZone: "America/Los_Angeles",
                cancelUrl,
                rescheduleUrl,
              }),
            `Calendly booking ${eventUri} <${email}>`,
          );

          const subjectPrefix =
            syncResult.action === "flagged-multiple" ? "[NEEDS REVIEW] " : "";
          const subject = `${subjectPrefix}New booking: ${name} — ${startTime}`;
          const text = [
            `New consultation booked via Calendly`,
            ``,
            `Name:    ${name}`,
            `Email:   ${email}`,
            `Event:   ${eventName}`,
            `Time:    ${startTime}`,
            qas ? `\nResponses:\n${qas}` : "",
            ``,
            `Reschedule: ${rescheduleUrl}`,
            `Cancel:     ${cancelUrl}`,
            ``,
            `Received: ${new Date().toISOString()}`,
          ].join("\n");

          const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#0b1d33">New consultation booked</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;color:#6b6559;width:100px">Name</td>
        <td style="padding:8px;font-weight:600">${name}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${email}">${email}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Time</td>
        <td style="padding:8px;font-weight:600;color:#c5a55a">${startTime}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Event</td>
        <td style="padding:8px">${eventName}</td></tr>
  </table>
  ${
    qas
      ? `<div style="margin-top:20px;padding:16px;background:#f5f0e8;border-left:3px solid #c5a55a">
           <strong>Intake responses:</strong><br/><br/>
           ${qas.replace(/\n/g, "<br/>")}
         </div>`
      : ""
  }
  <div style="margin-top:20px">
    <a href="${rescheduleUrl}" style="margin-right:16px;color:#0b1d33">Reschedule</a>
    <a href="${cancelUrl}" style="color:#c62828">Cancel</a>
  </div>
  <p style="margin-top:20px;font-size:12px;color:#9a9088">
    Received: ${new Date().toISOString()}
  </p>
</div>`;

          await Promise.all([
            mailer.sendEmail({ to: MICHAEL_EMAIL, subject, text, html }),
            forwardDownstream({
              source: "calendly",
              eventType: "booking.created",
              name,
              email,
              eventName,
              startTime: event.start_time,
              endTime: event.end_time,
              questionsAndAnswers: payload?.questions_and_answers || [],
              cancelUrl,
              rescheduleUrl,
              receivedAt: new Date().toISOString(),
            }),
          ]);
        } else if (eventType === "invitee.canceled") {
          const reason = invitee?.cancellation?.reason || "(no reason given)";
          const subject = `Booking canceled: ${name}`;
          const text = [
            `Consultation canceled`,
            ``,
            `Name:   ${name}`,
            `Email:  ${email}`,
            `Event:  ${eventName}`,
            `Time:   ${startTime}`,
            `Reason: ${reason}`,
            ``,
            `Received: ${new Date().toISOString()}`,
          ].join("\n");

          const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#c62828">Consultation canceled</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;color:#6b6559;width:100px">Name</td>
        <td style="padding:8px;font-weight:600">${name}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${email}">${email}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Was</td>
        <td style="padding:8px">${startTime}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Reason</td>
        <td style="padding:8px">${reason}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:12px;color:#9a9088">
    Received: ${new Date().toISOString()}
  </p>
</div>`;

          await Promise.all([
            mailer.sendEmail({ to: MICHAEL_EMAIL, subject, text, html }),
            forwardDownstream({
              source: "calendly",
              eventType: "booking.canceled",
              name,
              email,
              eventName,
              startTime: event.start_time,
              cancellationReason: reason,
              receivedAt: new Date().toISOString(),
            }),
          ]);

          await syncPipelineSafely(
            () => pipelineSync.syncCalendlyCancellation({ eventUri }),
            `Calendly cancellation ${eventUri} <${email}>`,
          );
        } else {
          console.log(`[calendly] Unhandled event type: ${eventType}`);
        }
      })().catch((err) => {
        console.error(
          `[calendly] Background processing failed for ${eventType}:`,
          err,
        );
      });
    } catch (err) {
      console.error("[calendly] Handler error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Start (only when run directly — `require("./server")` from tests does not
// bind a port)
// ---------------------------------------------------------------------------
if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT}`);
    console.log(`[server] Email notifications → ${MICHAEL_EMAIL} (via Microsoft Graph)`);
    console.log(`[server] Calendly signing: ${Boolean(CALENDLY_SIGNING_KEY)}`);
    console.log(`[server] Downstream URL: ${DOWNSTREAM_URL || "(none)"}`);
  });
}

module.exports = { createApp };
