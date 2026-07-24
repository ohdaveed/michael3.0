"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("./server");

function fakePipelineSync(overrides = {}) {
  const calls = { tally: [], booking: [], cancellation: [] };
  return {
    calls,
    syncTallyMessage: async (input) => {
      calls.tally.push(input);
      if (overrides.tallyThrows) throw new Error("sync failed");
      if (overrides.tallyFlagsMultiple) {
        return { ok: true, action: "flagged-multiple", itemId: "x" };
      }
      return { ok: true, action: "created", itemId: "1" };
    },
    syncCalendlyBooking: async (input) => {
      calls.booking.push(input);
      return { ok: true, action: "created", itemId: "1" };
    },
    syncCalendlyCancellation: async (input) => {
      calls.cancellation.push(input);
      return { ok: true, action: "cancelled", itemId: "1" };
    },
  };
}

function fakeMailer() {
  const calls = [];
  return {
    calls,
    sendEmail: async (input) => {
      calls.push(input);
    },
  };
}

async function withServer(pipelineSync, fn) {
  const app = createApp({ pipelineSync, mailer: fakeMailer() });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const TALLY_BODY = {
  data: {
    submissionId: "test-001",
    formId: "ob17lb",
    fields: [
      { label: "First name", value: "Jane" },
      { label: "Last name", value: "Doe" },
      { label: "Email", value: "jane@example.com" },
      { label: "Phone", value: "415-555-0100" },
      { label: "Service needed", value: "Will Only" },
      { label: "Message", value: "Test message." },
      { label: "form_source", value: "lehr-law-contact" },
      { label: "contract_version", value: "2" },
      { label: "page", value: "contact" },
    ],
  },
};

test("POST /webhooks/tally calls pipelineSync.syncTallyMessage and returns 200", async () => {
  const sync = fakePipelineSync();
  await withServer(sync, async (base) => {
    const res = await fetch(`${base}/webhooks/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TALLY_BODY),
    });
    assert.equal(res.status, 200);
    assert.equal(sync.calls.tally.length, 1);
    assert.equal(sync.calls.tally[0].email, "jane@example.com");
    assert.equal(sync.calls.tally[0].service, "Will Only");
  });
});

test("POST /webhooks/tally still returns 200 when the SharePoint sync throws", async () => {
  const sync = fakePipelineSync({ tallyThrows: true });
  await withServer(sync, async (base) => {
    const res = await fetch(`${base}/webhooks/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TALLY_BODY),
    });
    assert.equal(res.status, 200);
    assert.equal(sync.calls.tally.length, 1);
  });
});

test("POST /webhooks/tally still returns 200 and calls pipelineSync normally when the sync flags multiple matches", async () => {
  const sync = fakePipelineSync({ tallyFlagsMultiple: true });
  await withServer(sync, async (base) => {
    const res = await fetch(`${base}/webhooks/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TALLY_BODY),
    });
    assert.equal(res.status, 200);
    assert.equal(sync.calls.tally.length, 1);
    assert.equal(sync.calls.tally[0].email, "jane@example.com");
    assert.equal(sync.calls.tally[0].service, "Will Only");
  });
});

test("POST /webhooks/tally rejects an unknown formId before calling pipelineSync", async () => {
  const sync = fakePipelineSync();
  await withServer(sync, async (base) => {
    const res = await fetch(`${base}/webhooks/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { submissionId: "x", formId: "wrong-form" },
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(sync.calls.tally.length, 0);
  });
});

const TALLY_BODY_DROPDOWN_SHAPE = {
  data: {
    submissionId: "test-002",
    formId: "ob17lb",
    fields: [
      { label: "First name", value: "Jane" },
      { label: "Last name", value: "Doe" },
      { label: "Email", value: "jane@example.com" },
      { label: "Phone", value: "415-555-0100" },
      {
        label: "Service needed",
        value: ["b57cf5ca-38a1-4741-8820-eb125dafc31f"],
        options: [
          { id: "b57cf5ca-38a1-4741-8820-eb125dafc31f", text: "Complete Living Trust Package" },
          { id: "other-option-id", text: "Will Only" },
        ],
      },
      { label: "Message", value: "Test message." },
      { label: "form_source", value: "lehr-law-contact" },
      { label: "contract_version", value: "2" },
      { label: "page", value: "contact" },
    ],
  },
};

test("POST /webhooks/tally resolves a dropdown field's option ID to its display text", async () => {
  const sync = fakePipelineSync();
  await withServer(sync, async (base) => {
    const res = await fetch(`${base}/webhooks/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TALLY_BODY_DROPDOWN_SHAPE),
    });
    assert.equal(res.status, 200);
    assert.equal(sync.calls.tally.length, 1);
    assert.equal(sync.calls.tally[0].service, "Complete Living Trust Package");
  });
});

const CALENDLY_CREATED_BODY = {
  event: "invitee.created",
  payload: {
    uri: "https://api.calendly.com/scheduled_events/abc/invitees/def",
    invitee: { name: "Jane Doe", email: "jane@example.com" },
    event: {
      name: "Estate Planning Consultation",
      start_time: "2026-08-01T18:00:00.000Z",
      end_time: "2026-08-01T18:30:00.000Z",
    },
    cancel_url: "https://calendly.com/cancellations/def",
    reschedule_url: "https://calendly.com/reschedulings/def",
    questions_and_answers: [],
  },
};

test("POST /webhooks/calendly (invitee.created) calls syncCalendlyBooking and returns 200", async () => {
  const sync = fakePipelineSync();
  await withServer(sync, async (base) => {
    const res = await fetch(`${base}/webhooks/calendly`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CALENDLY_CREATED_BODY),
    });
    assert.equal(res.status, 200);
    assert.equal(sync.calls.booking.length, 1);
    assert.equal(
      sync.calls.booking[0].eventUri,
      "https://api.calendly.com/scheduled_events/abc/invitees/def",
    );
  });
});

const CALENDLY_CANCELED_BODY = {
  event: "invitee.canceled",
  payload: {
    uri: "https://api.calendly.com/scheduled_events/abc/invitees/def",
    invitee: {
      name: "Jane Doe",
      email: "jane@example.com",
      cancellation: { reason: "scheduling conflict" },
    },
    event: {
      name: "Estate Planning Consultation",
      start_time: "2026-08-01T18:00:00.000Z",
    },
  },
};

test("POST /webhooks/calendly (invitee.canceled) calls syncCalendlyCancellation and returns 200", async () => {
  const sync = fakePipelineSync();
  await withServer(sync, async (base) => {
    const res = await fetch(`${base}/webhooks/calendly`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CALENDLY_CANCELED_BODY),
    });
    assert.equal(res.status, 200);
    assert.equal(sync.calls.cancellation.length, 1);
    assert.equal(
      sync.calls.cancellation[0].eventUri,
      "https://api.calendly.com/scheduled_events/abc/invitees/def",
    );
  });
});
