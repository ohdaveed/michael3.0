"use strict";

// One-off manual sender for the lead acknowledgment email (lib/lead-ack.js).
// For leads whose submission arrived before LEAD_ACK_ENABLED was turned on.
//
// Requires the same env vars as the server (GRAPH_TENANT_ID,
// GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, MICHAEL_EMAIL), e.g.:
//   railway run node scripts/send-lead-ack.js bill@example.com Bill "Trust Amendment"
//
// Usage: node scripts/send-lead-ack.js <to> [firstName] [service]

const { createMailer } = require("../lib/mailer");
const { buildLeadAckEmail } = require("../lib/lead-ack");

const [to, firstName = "", service = ""] = process.argv.slice(2);
if (!to || !to.includes("@")) {
  console.error(
    "Usage: node scripts/send-lead-ack.js <to> [firstName] [service]",
  );
  process.exit(1);
}

const bookingUrl =
  process.env.BOOKING_URL ||
  "https://calendly.com/lehrlaw/estate-planning-consultation";
const fromMailbox = process.env.MICHAEL_EMAIL || "michael@lehr-law.com";

const mailer = createMailer({ fromMailbox });

mailer
  .sendEmail({ to, ...buildLeadAckEmail({ firstName, service, bookingUrl }) })
  .then(() => {
    console.log(
      `Done — check for "[email] Sent:" above (from ${fromMailbox}).`,
    );
  });
