"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseTallyWebhook,
  parseCalendlyWebhook,
  parseGraphNotification,
} = require("./schemas");

// --- Tally ------------------------------------------------------------------

test("accepts a Tally submission with text and choice fields", () => {
  const result = parseTallyWebhook({
    eventId: "evt_1",
    data: {
      submissionId: "sub_1",
      formId: "ob17lb",
      fields: [
        { label: "Email", type: "INPUT_EMAIL", value: "jane@example.com" },
        {
          label: "Service needed",
          type: "DROPDOWN",
          value: ["opt_a"],
          options: [{ id: "opt_a", text: "Will Only" }],
        },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.data.formId, "ob17lb");
  assert.equal(result.data.data.fields.length, 2);
});

test("rejects a Tally payload with no formId", () => {
  const result = parseTallyWebhook({ data: { fields: [] } });
  assert.equal(result.ok, false);
  assert.match(result.error, /formId/);
});

test("rejects a Tally payload with no data object", () => {
  assert.equal(parseTallyWebhook({}).ok, false);
  assert.equal(parseTallyWebhook(null).ok, false);
  assert.equal(parseTallyWebhook("not an object").ok, false);
});

test("defaults missing Tally fields to an empty array", () => {
  const result = parseTallyWebhook({ data: { formId: "ob17lb" } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.data.fields, []);
});

test("accepts a null field value, which Tally sends for a blank input", () => {
  const result = parseTallyWebhook({
    data: { formId: "ob17lb", fields: [{ label: "Phone", value: null }] },
  });
  assert.equal(result.ok, true);
});

test("keeps unrecognised Tally keys from failing the parse", () => {
  const result = parseTallyWebhook({
    data: { formId: "ob17lb", fields: [], somethingNew: true },
    futureTopLevelKey: 1,
  });
  assert.equal(result.ok, true);
});

// --- Calendly ---------------------------------------------------------------

test("accepts an invitee.created payload", () => {
  const result = parseCalendlyWebhook({
    event: "invitee.created",
    payload: {
      uri: "https://api.calendly.com/scheduled_events/abc/invitees/def",
      invitee: { name: "Jane Doe", email: "jane@example.com" },
      event: { name: "Consultation", start_time: "2026-09-01T17:00:00Z" },
      questions_and_answers: [{ question: "Topic?", answer: "Trust" }],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.event, "invitee.created");
});

test("rejects a Calendly payload with no event type", () => {
  const result = parseCalendlyWebhook({ payload: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /event/);
});

test("defaults a missing Calendly payload to an empty object", () => {
  const result = parseCalendlyWebhook({ event: "invitee.canceled" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.payload, {});
});

test("accepts null first_name/last_name, which Calendly sends when unset", () => {
  const result = parseCalendlyWebhook({
    event: "invitee.created",
    payload: { invitee: { first_name: null, last_name: null } },
  });
  assert.equal(result.ok, true);
});

// --- Graph ------------------------------------------------------------------

test("accepts a Graph notification batch", () => {
  const result = parseGraphNotification({
    value: [
      {
        clientState: "secret",
        resourceData: { id: "17" },
        changeType: "updated",
      },
      { clientState: "secret", resourceData: { id: "18" } },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.value.length, 2);
});

test("defaults a missing Graph value array to empty", () => {
  const result = parseGraphNotification({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.value, []);
});

test("rejects a Graph value that is not an array", () => {
  const result = parseGraphNotification({ value: "nope" });
  assert.equal(result.ok, false);
});
