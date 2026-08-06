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

async function withServer(pipelineSync, fn, appOptions = {}) {
  const app = createApp({ pipelineSync, mailer: fakeMailer(), ...appOptions });
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
          {
            id: "b57cf5ca-38a1-4741-8820-eb125dafc31f",
            text: "Complete Living Trust Package",
          },
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

// The Tally handler responds before its email sends finish — poll until the
// background block has produced the expected number of mailer calls.
async function until(cond, timeoutMs = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for background processing");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("POST /webhooks/tally sends the lead an acknowledgment when leadAckEnabled is true", async () => {
  const sync = fakePipelineSync();
  const mailer = fakeMailer();
  await withServer(
    sync,
    async (base) => {
      const res = await fetch(`${base}/webhooks/tally`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TALLY_BODY),
      });
      assert.equal(res.status, 200);
      await until(() => mailer.calls.length >= 2);
      const ack = mailer.calls.find((c) => c.to === "jane@example.com");
      assert.ok(ack, "expected an email to the lead");
      assert.ok(ack.text.includes("what-to-expect.html"));
      assert.ok(ack.text.includes("https://calendly.example/consult"));
      assert.ok(ack.html.includes("https://calendly.example/consult"));
      const michael = mailer.calls.find((c) => c.to !== "jane@example.com");
      assert.ok(michael, "Michael's notification must still send");
    },
    {
      mailer,
      leadAckEnabled: true,
      bookingUrl: "https://calendly.example/consult",
    },
  );
});

test("POST /webhooks/tally sends no lead acknowledgment when leadAckEnabled is false (default)", async () => {
  const sync = fakePipelineSync();
  const mailer = fakeMailer();
  await withServer(
    sync,
    async (base) => {
      const res = await fetch(`${base}/webhooks/tally`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TALLY_BODY),
      });
      assert.equal(res.status, 200);
      await until(() => mailer.calls.length >= 1);
      // Give any stray second send a moment to appear before asserting.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(mailer.calls.length, 1);
      assert.notEqual(mailer.calls[0].to, "jane@example.com");
    },
    { mailer, leadAckEnabled: false },
  );
});

test("POST /webhooks/tally skips the lead acknowledgment when the submission has no usable email", async () => {
  const sync = fakePipelineSync();
  const mailer = fakeMailer();
  const body = JSON.parse(JSON.stringify(TALLY_BODY));
  body.data.fields = body.data.fields.filter((f) => f.label !== "Email");
  await withServer(
    sync,
    async (base) => {
      const res = await fetch(`${base}/webhooks/tally`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      await until(() => mailer.calls.length >= 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(mailer.calls.length, 1);
    },
    { mailer, leadAckEnabled: true },
  );
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

function fakeStageEngine({ throws = false } = {}) {
  const calls = [];
  return {
    calls,
    processNotifications: async () => {
      calls.push("run");
      if (throws) throw new Error("delta failed");
      return [];
    },
  };
}

test("POST /webhooks/graph-pipeline echoes the validationToken as text/plain without processing", async () => {
  const engine = fakeStageEngine();
  await withServer(
    fakePipelineSync(),
    async (base) => {
      const res = await fetch(
        `${base}/webhooks/graph-pipeline?validationToken=abc%20123`,
        { method: "POST" },
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /text\/plain/);
      assert.equal(await res.text(), "abc 123");
      assert.equal(engine.calls.length, 0);
    },
    { stageEngine: engine, graphClientState: "test-secret" },
  );
});

test("POST /webhooks/graph-pipeline rejects a wrong clientState with 401 before any processing", async () => {
  const engine = fakeStageEngine();
  await withServer(
    fakePipelineSync(),
    async (base) => {
      const res = await fetch(`${base}/webhooks/graph-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: [{ subscriptionId: "s1", clientState: "wrong" }],
        }),
      });
      assert.equal(res.status, 401);
      assert.equal(engine.calls.length, 0);
    },
    { stageEngine: engine, graphClientState: "test-secret" },
  );
});

test("POST /webhooks/graph-pipeline rejects a batch where any entry has a bad clientState", async () => {
  const engine = fakeStageEngine();
  await withServer(
    fakePipelineSync(),
    async (base) => {
      const res = await fetch(`${base}/webhooks/graph-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: [
            { subscriptionId: "s1", clientState: "test-secret" },
            { subscriptionId: "s1", clientState: "wrong" },
          ],
        }),
      });
      assert.equal(res.status, 401);
      assert.equal(engine.calls.length, 0);
    },
    { stageEngine: engine, graphClientState: "test-secret" },
  );
});

test("POST /webhooks/graph-pipeline accepts a valid batch with 202 and runs the stage engine", async () => {
  const engine = fakeStageEngine();
  await withServer(
    fakePipelineSync(),
    async (base) => {
      const res = await fetch(`${base}/webhooks/graph-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: [{ subscriptionId: "s1", clientState: "test-secret" }],
        }),
      });
      assert.equal(res.status, 202);
      assert.equal(engine.calls.length, 1);
    },
    { stageEngine: engine, graphClientState: "test-secret" },
  );
});

test("POST /webhooks/graph-pipeline rejects an empty notification batch", async () => {
  const engine = fakeStageEngine();
  await withServer(
    fakePipelineSync(),
    async (base) => {
      const res = await fetch(`${base}/webhooks/graph-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: [] }),
      });
      assert.equal(res.status, 401);
      assert.equal(engine.calls.length, 0);
    },
    { stageEngine: engine, graphClientState: "test-secret" },
  );
});

test("POST /webhooks/graph-pipeline still returns 202 when background processing throws", async () => {
  const engine = fakeStageEngine({ throws: true });
  await withServer(
    fakePipelineSync(),
    async (base) => {
      const res = await fetch(`${base}/webhooks/graph-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: [{ subscriptionId: "s1", clientState: "test-secret" }],
        }),
      });
      assert.equal(res.status, 202);
    },
    { stageEngine: engine, graphClientState: "test-secret" },
  );
});

// ---------------------------------------------------------------------------
// Request body handling
// ---------------------------------------------------------------------------

test("POST /webhooks/tally rejects a body over the size limit", async () => {
  await withServer(fakePipelineSync(), async (base) => {
    // Comfortably past the 100kb cap. The point is that this is refused up
    // front rather than buffered — the previous hand-rolled parser had no cap.
    const oversized = JSON.stringify({
      data: { formId: "ob17lb", fields: [], pad: "x".repeat(200_000) },
    });
    const res = await fetch(`${base}/webhooks/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversized,
    });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: "Invalid request body" });
  });
});

test("POST /webhooks/tally answers 400 for malformed JSON", async () => {
  await withServer(fakePipelineSync(), async (base) => {
    const res = await fetch(`${base}/webhooks/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    // Previously this parsed to {} and fell through to the formId check.
    // An explicit 400 with a JSON body is the better answer to a webhook
    // sender, and it must not be Express's default HTML 500.
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid request body" });
  });
});

test("POST /webhooks/tally rejects a structurally invalid payload", async () => {
  await withServer(fakePipelineSync(), async (base) => {
    const res = await fetch(`${base}/webhooks/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { fields: [] } }), // no formId
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid payload" });
  });
});

test("POST /webhooks/calendly rejects a payload with no event type", async () => {
  await withServer(fakePipelineSync(), async (base) => {
    const res = await fetch(`${base}/webhooks/calendly`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { invitee: {} } }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid payload" });
  });
});

test("the health check is not rate limited", async () => {
  await withServer(fakePipelineSync(), async (base) => {
    // Railway probes this continuously; throttling it would fail the deploy.
    // The limiter is mounted on /webhooks only, so well past its 120/min
    // budget still succeeds here.
    for (let i = 0; i < 150; i++) {
      const res = await fetch(`${base}/`);
      assert.equal(res.status, 200);
    }
  });
});

test("the webhook routes are rate limited", async () => {
  await withServer(fakePipelineSync(), async (base) => {
    const send = () =>
      fetch(`${base}/webhooks/tally`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { fields: [] } }), // 400s, still counted
      });

    let limited = false;
    for (let i = 0; i < 130; i++) {
      const res = await send();
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    assert.equal(limited, true, "expected a 429 within 130 requests");
  });
});
