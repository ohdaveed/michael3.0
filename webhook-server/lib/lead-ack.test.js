"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildLeadAckEmail } = require("./lead-ack");

const BOOKING_URL = "https://calendly.com/lehrlaw/estate-planning-consultation";

test("buildLeadAckEmail includes the what-to-expect link and booking link in both bodies", () => {
  const { subject, text, html } = buildLeadAckEmail({
    firstName: "Jane",
    service: "Will Only",
    bookingUrl: BOOKING_URL,
  });
  assert.ok(subject.length > 0);
  for (const body of [text, html]) {
    assert.ok(body.includes("https://www.lehr-law.com/what-to-expect.html"));
    assert.ok(body.includes(BOOKING_URL));
  }
  assert.ok(text.includes("Hi Jane,"));
  assert.ok(text.includes("Will Only"));
});

test("buildLeadAckEmail handles a missing first name and unspecified service", () => {
  const { text } = buildLeadAckEmail({
    firstName: "",
    service: "(not specified)",
    bookingUrl: BOOKING_URL,
  });
  assert.ok(text.includes("Hello,"));
  assert.ok(!text.includes("(not specified)"));
  assert.ok(text.includes("Your message has been received."));
});

test("buildLeadAckEmail escapes HTML in form-supplied values", () => {
  const { html } = buildLeadAckEmail({
    firstName: '<img src=x onerror=alert(1)>"Jane"',
    service: "Will Only",
    bookingUrl: BOOKING_URL,
  });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&quot;Jane&quot;"));
});

test("buildLeadAckEmail does not create an attorney-client relationship claim and warns about confidential detail", () => {
  const { text } = buildLeadAckEmail({
    firstName: "Jane",
    service: "Will Only",
    bookingUrl: BOOKING_URL,
  });
  assert.ok(text.includes("does not create an attorney-client"));
  assert.ok(text.includes("confidential"));
});
