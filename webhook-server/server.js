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
const rateLimit = require("express-rate-limit");
const { logger } = require("./lib/logger");
const { escapeHtml, safeHttpsUrl, singleLine } = require("./lib/html");
const {
  parseTallyWebhook,
  parseCalendlyWebhook,
  parseGraphNotification,
} = require("./lib/schemas");
const { createGraphClient } = require("./lib/graph-client");
const { createSharepointClient } = require("./lib/sharepoint");
const { createPipelineSync } = require("./lib/pipeline-sync");
const { createMailer } = require("./lib/mailer");
const { buildLeadAckEmail } = require("./lib/lead-ack");
const { createPipelineActivityClient } = require("./lib/pipeline-activity");
const { createSubscriptionsClient } = require("./lib/subscriptions");
const { createStageEngine } = require("./lib/stage-engine");
const { createItemLock } = require("./lib/pipeline-item-lock");

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
// Client-facing acknowledgment email (client-pipeline.md Flow D step 5).
// Off by default: the template copy needs Michael's approval [D17] before
// it goes in front of leads — set LEAD_ACK_ENABLED=true in Railway once
// approved.
const LEAD_ACK_ENABLED = process.env.LEAD_ACK_ENABLED === "true";
// Keep in sync with public/js/booking-url.js (the site's single source of
// truth for the booking destination).
const BOOKING_URL =
  process.env.BOOKING_URL ||
  "https://calendly.com/lehrlaw/estate-planning-consultation";
// Flow E — Graph change notifications on the Client Pipeline list.
// Both must be set for the subscription bootstrap to run; the webhook
// route itself rejects everything (401) while the clientState is unset.
const GRAPH_CLIENT_STATE = process.env.GRAPH_SUBSCRIPTION_CLIENT_STATE || "";
const GRAPH_NOTIFICATION_URL = process.env.GRAPH_NOTIFICATION_URL || "";

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
    // fetch resolves for 4xx/5xx, so status has to be checked explicitly —
    // otherwise a rejected forward is logged as a delivered one.
    if (res.ok) {
      logger.info({ scope: "downstream", status: res.status }, "forwarded");
    } else {
      logger.error(
        { scope: "downstream", status: res.status },
        "forward rejected by downstream",
      );
    }
  } catch (err) {
    logger.error({ scope: "downstream", err: err.message }, "forward failed");
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

// Flow E stage engine — shares one Graph client across the SharePoint,
// activity-ledger, and mail dependencies.
function buildDefaultStageEngine(mailer) {
  const graphClient = createGraphClient();
  return createStageEngine({
    sharepointClient: createSharepointClient({ graphClient }),
    activityClient: createPipelineActivityClient({ graphClient }),
    itemLock: createItemLock(),
    mailer,
    michaelEmail: MICHAEL_EMAIL,
  });
}

// ---------------------------------------------------------------------------
// Tally field value resolution
// Choice-type fields (dropdowns, multi-select, etc.) send `value` as the
// selected option's internal ID(s), with a sibling `options` array mapping
// those IDs to display text — unlike plain text fields, where `value` is
// the literal answer. Resolve IDs to text here so downstream code (product
// taxonomy mapping, email/SharePoint content) never sees a raw UUID.
// ---------------------------------------------------------------------------
function resolveTallyFieldValue(f) {
  if (Array.isArray(f.value) && Array.isArray(f.options)) {
    const idToText = new Map(f.options.map((o) => [o.id, o.text]));
    return f.value.map((v) => idToText.get(v) ?? v).join(", ");
  }
  return Array.isArray(f.value) ? f.value.join(", ") : f.value;
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

  // timingSafeEqual throws on a length mismatch, and a malformed v1= value
  // decodes to a short buffer. Without this guard a junk signature became an
  // exception caught by the route's outer try/catch and answered 500 instead
  // of 401. Comparing lengths first is not a timing leak: the expected length
  // is a constant.
  const received = Buffer.from(signature, "hex");
  const expected = Buffer.from(expectedSig, "hex");
  if (received.length !== expected.length) return false;

  return crypto.timingSafeEqual(received, expected);
}

// ---------------------------------------------------------------------------
// Graph clientState validation
// Graph echoes the subscription's clientState verbatim on every
// notification — a static shared secret, not an HMAC. Still compared
// constant-time (SHA-256 both sides so timingSafeEqual gets equal-length
// buffers), consistent with validateCalendlySignature's discipline.
// ---------------------------------------------------------------------------
function validateGraphClientState(notifications, expected) {
  if (!expected || notifications.length === 0) return false;
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return notifications.every((n) => {
    const gotHash = crypto
      .createHash("sha256")
      .update(String(n.clientState || ""))
      .digest();
    return crypto.timingSafeEqual(gotHash, expectedHash);
  });
}

// ---------------------------------------------------------------------------
// App factory — accepts injectable deps so tests can pass a fake
// pipelineSync/mailer instead of hitting real Graph/SharePoint/Mail.
// ---------------------------------------------------------------------------
function createApp({
  pipelineSync = buildDefaultPipelineSync(),
  mailer = buildDefaultMailer(),
  leadAckEnabled = LEAD_ACK_ENABLED,
  bookingUrl = BOOKING_URL,
  stageEngine = null,
  graphClientState = GRAPH_CLIENT_STATE,
} = {}) {
  const app = express();
  // Railway serves this behind a reverse proxy, so req.ip is the proxy's
  // address unless Express is told to read X-Forwarded-For. Without this the
  // rate limiter below keys every request to the same bucket: one caller
  // could burn the shared budget and lock out real Tally, Calendly, and
  // Graph deliveries. `1` trusts exactly one hop — `true` would let a client
  // spoof the header and evade the limit entirely.
  app.set("trust proxy", 1);
  const engine = stageEngine || buildDefaultStageEngine(mailer);

  // `contextLabel` identifies the record and must stay free of contact
  // details, because it is logged. The lead's email is passed separately: it
  // goes under a key lib/logger.js redacts, while the alert email — sent to
  // Michael's own mailbox about his own prospective client — still names them.
  async function syncPipelineSafely(fn, contextLabel, email = "") {
    const who = email ? `${contextLabel} <${email}>` : contextLabel;
    try {
      const result = await fn();
      logger.info(
        {
          scope: "pipeline",
          context: contextLabel,
          email,
          action: result.action,
          itemId: result.itemId || null,
        },
        "sync complete",
      );
      return result;
    } catch (err) {
      logger.error(
        { scope: "pipeline", context: contextLabel, email, err: err.message },
        "sync failed",
      );
      await mailer.sendEmail({
        to: MICHAEL_EMAIL,
        subject: `[ALERT] SharePoint sync failed — ${who}`,
        text: [
          `SharePoint sync failed for: ${who}`,
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

  // Public, unauthenticated endpoints. Generous enough that a real burst
  // (Calendly retries, a Graph notification batch) is never touched.
  const webhookLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });
  // Mounted before express.json deliberately. Behind the parser, a malformed
  // or near-limit body is buffered, parsed, rejected, and logged before the
  // limiter ever sees it — so the cheapest requests to send would be the ones
  // that skip the budget entirely. Scoped to /webhooks so the health check
  // stays unlimited; Railway probes it continuously.
  app.use("/webhooks", webhookLimiter);

  // express.json rather than a hand-rolled parser, for the `limit`: the
  // previous version concatenated request chunks into a string with no size
  // cap and no error listener, so an oversized or aborted body was
  // unbounded work on a public endpoint. 100kb is far above any real Tally,
  // Calendly, or Graph payload.
  //
  // `verify` runs before parsing, which is the only place the raw bytes are
  // still available — validateCalendlySignature needs them as a string for
  // the HMAC.
  app.use(
    express.json({
      limit: "100kb",
      verify: (req, res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }),
  );

  // express.json rejects malformed JSON and oversized bodies by passing an
  // error here. Answer with the status it determined (400 / 413) instead of
  // letting Express's default handler emit an HTML 500 to a webhook sender.
  app.use((err, req, res, next) => {
    if (!err) return next();
    const status = err.status || err.statusCode || 400;
    logger.warn(
      { scope: "http", status, err: err.type || err.message },
      "rejected request body",
    );
    if (res.headersSent) return next(err);
    return res.status(status).json({ error: "Invalid request body" });
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
    const log = logger.child({ scope: "tally" });
    let submissionId;
    try {
      const parsed = parseTallyWebhook(req.body);
      if (!parsed.ok) {
        log.warn({ reason: parsed.error }, "rejected malformed payload");
        return res.status(400).json({ error: "Invalid payload" });
      }
      const body = parsed.data;
      submissionId = body.data.submissionId;
      const formId = body.data.formId;

      if (formId !== TALLY_FORM_ID) {
        log.warn({ formId }, "unknown formId");
        return res.status(400).json({ error: "Unknown form" });
      }

      const fields = {};
      for (const f of body.data.fields) {
        fields[f.label] = resolveTallyFieldValue(f);
      }

      if (fields["form_source"] !== "lehr-law-contact") {
        log.warn(
          { formSource: fields["form_source"] },
          "unexpected form_source",
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

      // firstName/lastName/email are redacted by lib/logger.js; they are
      // passed so the shape is greppable, not so the values are readable.
      log.info(
        { submissionId, firstName, lastName, email },
        "submission received",
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
          `Tally submission ${submissionId}`,
          email,
        );

        const subjectPrefix =
          syncResult.action === "flagged-multiple" ? "[NEEDS REVIEW] " : "";
        const subject = singleLine(
          `${subjectPrefix}New message from ${firstName} ${lastName} — ${service}`,
        );
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
        <td style="padding:8px;font-weight:600">${escapeHtml(firstName)} ${escapeHtml(lastName)}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Phone</td>
        <td style="padding:8px">${escapeHtml(phone)}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Service</td>
        <td style="padding:8px">${escapeHtml(service)}</td></tr>
  </table>
  <div style="margin-top:20px;padding:16px;background:#f5f0e8;border-left:3px solid #c5a55a">
    <strong>Message:</strong><br/><br/>
    ${escapeHtml(message).replace(/\n/g, "<br/>")}
  </div>
  <p style="margin-top:20px;font-size:12px;color:#9a9088">
    Submission ID: ${escapeHtml(submissionId)} &middot; Received: ${new Date().toISOString()}
  </p>
</div>`;

        // Acknowledgment to the lead (Flow D step 5): "received, here's
        // what happens next" + the booking link. Sent regardless of the
        // sync outcome — the message was received either way — but never
        // for payloads that failed validation (those 400'd above and no
        // acknowledgment is sent). mailer.sendEmail catches its own
        // failures, so a bad lead address can't break Michael's
        // notification.
        const sends = [
          mailer.sendEmail({ to: MICHAEL_EMAIL, subject, text, html }),
        ];
        if (leadAckEnabled && email.includes("@")) {
          sends.push(
            mailer.sendEmail({
              to: email,
              ...buildLeadAckEmail({ firstName, service, bookingUrl }),
            }),
          );
        }

        await Promise.all([
          ...sends,
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
        log.error(
          { submissionId, err: err.message },
          "background processing failed",
        );
      });
    } catch (err) {
      log.error({ err: err.message }, "handler error");
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
    const log = logger.child({ scope: "calendly" });
    let eventType;
    try {
      // Validate HMAC signature
      if (!validateCalendlySignature(req)) {
        log.warn("invalid signature - rejecting");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const parsed = parseCalendlyWebhook(req.body);
      if (!parsed.ok) {
        log.warn({ reason: parsed.error }, "rejected malformed payload");
        return res.status(400).json({ error: "Invalid payload" });
      }
      const body = parsed.data;
      eventType = body.event;
      const payload = body.payload;
      const invitee = payload.invitee || {};
      // payload.event is either the expanded object or the scheduled-event
      // URI string (see lib/schemas.js). Only the object form carries the
      // fields below; the string degrades to the same defaults as before.
      const event =
        payload.event && typeof payload.event === "object" ? payload.event : {};
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
      // Rendered into href attributes below. escapeHtml cannot reject a
      // `javascript:` scheme, so these are scheme-checked here instead; a
      // rejected value becomes "" and the link is simply omitted.
      const cancelUrl = safeHttpsUrl(payload?.cancel_url);
      const rescheduleUrl = safeHttpsUrl(payload?.reschedule_url);

      // Questions & answers (custom intake questions from the Calendly form)
      const qas = (payload?.questions_and_answers || [])
        .map((qa) => `${qa.question}: ${qa.answer}`)
        .join("\n");

      log.info({ eventType, name, email, startTime }, "booking event");

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
            `Calendly booking ${eventUri}`,
            email,
          );

          const subjectPrefix =
            syncResult.action === "flagged-multiple" ? "[NEEDS REVIEW] " : "";
          const subject = singleLine(
            `${subjectPrefix}New booking: ${name} — ${startTime}`,
          );
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
        <td style="padding:8px;font-weight:600">${escapeHtml(name)}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Time</td>
        <td style="padding:8px;font-weight:600;color:#c5a55a">${escapeHtml(startTime)}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Event</td>
        <td style="padding:8px">${escapeHtml(eventName)}</td></tr>
  </table>
  ${
    qas
      ? `<div style="margin-top:20px;padding:16px;background:#f5f0e8;border-left:3px solid #c5a55a">
           <strong>Intake responses:</strong><br/><br/>
           ${escapeHtml(qas).replace(/\n/g, "<br/>")}
         </div>`
      : ""
  }
  <div style="margin-top:20px">
    <a href="${escapeHtml(rescheduleUrl)}" style="margin-right:16px;color:#0b1d33">Reschedule</a>
    <a href="${escapeHtml(cancelUrl)}" style="color:#c62828">Cancel</a>
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
          const subject = singleLine(`Booking canceled: ${name}`);
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
        <td style="padding:8px;font-weight:600">${escapeHtml(name)}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Was</td>
        <td style="padding:8px">${escapeHtml(startTime)}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Reason</td>
        <td style="padding:8px">${escapeHtml(reason)}</td></tr>
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
            `Calendly cancellation ${eventUri}`,
            email,
          );
        } else {
          log.info({ eventType }, "unhandled event type");
        }
      })().catch((err) => {
        log.error(
          { eventType, err: err.message },
          "background processing failed",
        );
      });
    } catch (err) {
      log.error({ err: err.message }, "handler error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // -------------------------------------------------------------------------
  // POST /webhooks/graph-pipeline
  // Graph change notifications for the Client Pipeline list (Flow E).
  // Notifications carry no item data — the stage engine delta-queries the
  // list to find what changed.
  // -------------------------------------------------------------------------
  app.post("/webhooks/graph-pipeline", (req, res) => {
    const log = logger.child({ scope: "graph-pipeline" });
    try {
      // Subscription-creation validation handshake: echo the token as
      // text/plain within 10 seconds, before touching any Graph state —
      // it fires before a subscription exists to look anything up against.
      if (req.query.validationToken) {
        return res
          .status(200)
          .type("text/plain")
          .send(req.query.validationToken);
      }

      const parsedGraph = parseGraphNotification(req.body);
      if (!parsedGraph.ok) {
        log.warn({ reason: parsedGraph.error }, "rejected malformed payload");
        return res.status(400).json({ error: "Invalid payload" });
      }
      const notifications = parsedGraph.data.value;
      if (!validateGraphClientState(notifications, graphClientState)) {
        log.warn("clientState rejected");
        return res.status(401).json({ error: "Invalid clientState" });
      }

      // Graph enforces a fast-ack SLA on notification endpoints — respond
      // now, process in the background (same pattern as the other hooks).
      res.status(202).send();

      (async () => {
        const outcomes = await engine.processNotifications();
        const acted = outcomes.filter(
          (o) => o.action !== "skip" && o.action !== "unhandled",
        );
        log.info(
          { changed: outcomes.length, acted: acted.length },
          "delta processed",
        );
      })().catch((err) => {
        log.error({ err: err.message }, "background processing failed");
      });
    } catch (err) {
      log.error({ err: err.message }, "handler error");
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
    logger.info(
      {
        scope: "server",
        port: PORT,
        notificationsTo: MICHAEL_EMAIL,
        calendlySigning: Boolean(CALENDLY_SIGNING_KEY),
        leadAck: LEAD_ACK_ENABLED,
        downstream: Boolean(DOWNSTREAM_URL),
      },
      "listening",
    );
  });

  // Flow E subscription bootstrap: ensure immediately on boot (an interval
  // alone can miss a lapse across Railway restarts), then re-check every
  // 12 hours — renewals trigger when a subscription is within 48h of
  // expiry, far inside the ~30-day window.
  if (GRAPH_NOTIFICATION_URL && GRAPH_CLIENT_STATE) {
    const subscriptions = createSubscriptionsClient();
    const ensure = () =>
      subscriptions
        .ensureSubscription()
        .then((r) => logger.info({ scope: "subscriptions", ...r }, "ensured"))
        .catch((err) =>
          logger.error(
            { scope: "subscriptions", err: err.message },
            "ensure failed",
          ),
        );
    ensure();
    setInterval(ensure, 12 * 60 * 60 * 1000).unref();
  } else {
    logger.info(
      { scope: "server" },
      "graph pipeline notifications disabled (set GRAPH_NOTIFICATION_URL and GRAPH_SUBSCRIPTION_CLIENT_STATE)",
    );
  }
}

module.exports = { createApp };
