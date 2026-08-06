"use strict";

// Client-facing acknowledgment email for website contact-form messages —
// client-pipeline.md Flow D step 5: "received, here's what happens next"
// plus the booking link (converting message-senders into booked consults).
//
// Copy is DRAFT pending Michael's approval [D17]. The send is gated behind
// LEAD_ACK_ENABLED in server.js so deploying this code does not put
// unapproved copy in front of leads.

const WHAT_TO_EXPECT_URL = "https://www.lehr-law.com/what-to-expect.html";

// Field values come from the form submission, so everything interpolated into
// the HTML body is escaped. Shared with the Michael-facing notification
// emails in server.js, which render the same untrusted form content.
const { escapeHtml } = require("./html");

function buildLeadAckEmail({ firstName, service, bookingUrl }) {
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const hasService = service && service !== "(not specified)";
  const received = hasService
    ? `Your message about ${service} has been received.`
    : `Your message has been received.`;

  const subject = "Your message was received — Lehr Law";

  const text = [
    greeting,
    ``,
    `Thanks for reaching out. ${received} Michael reviews every message`,
    `personally and replies within 24 hours — usually the same day on`,
    `business days.`,
    ``,
    `What happens next: ${WHAT_TO_EXPECT_URL}`,
    ``,
    `If you'd like to skip the wait, you can book a free consultation`,
    `directly: ${bookingUrl}`,
    ``,
    `One note: sending a message does not create an attorney-client`,
    `relationship, so please hold off on sharing confidential details`,
    `(finances, beneficiaries, health information) until Michael asks`,
    `for them.`,
    ``,
    `Lehr Law — Estate Planning, San Francisco`,
  ].join("\n");

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#0b1d33">
  <h2 style="color:#0b1d33">${escapeHtml(received.replace(/\.$/, ""))}</h2>
  <p>${escapeHtml(greeting)}</p>
  <p>
    Thanks for reaching out. Michael reviews every message personally and
    replies within 24 hours &mdash; usually the same day on business days.
  </p>
  <p>
    In the meantime, here is
    <a href="${WHAT_TO_EXPECT_URL}" style="color:#0b1d33">what to expect next</a>.
  </p>
  <div style="margin:24px 0;padding:16px;background:#f5f0e8;border-left:3px solid #c5a55a">
    Ready to talk sooner? You can skip the wait and
    <a href="${escapeHtml(bookingUrl)}" style="color:#0b1d33;font-weight:600">book a free consultation</a>
    directly.
  </div>
  <p style="font-size:13px;color:#6b6559">
    One note: sending a message does not create an attorney-client
    relationship, so please hold off on sharing confidential details
    (finances, beneficiaries, health information) until Michael asks for
    them.
  </p>
  <p style="margin-top:24px;font-size:12px;color:#9a9088">
    Lehr Law &mdash; Estate Planning, San Francisco
  </p>
</div>`;

  return { subject, text, html };
}

module.exports = { buildLeadAckEmail };
