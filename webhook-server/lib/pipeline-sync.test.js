"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPipelineSync } = require("./pipeline-sync");

function fakeSharepointClient(overrides = {}) {
  const calls = { create: [], update: [] };
  return {
    calls,
    findOpenItemByEmail: overrides.findOpenItemByEmail || (async () => []),
    findItemByCalendlyEventUri:
      overrides.findItemByCalendlyEventUri || (async () => null),
    createPipelineItem: async (fields) => {
      calls.create.push(fields);
      return { id: "new-1" };
    },
    updatePipelineItem: async (itemId, fields) => {
      calls.update.push({ itemId, fields });
      return null;
    },
  };
}

const TALLY_INPUT = {
  submissionId: "sub-1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "415-555-0100",
  service: "Will Only",
};

test("syncTallyMessage creates a new row when no open item matches", async () => {
  const sp = fakeSharepointClient();
  const sync = createPipelineSync({ sharepointClient: sp });

  const result = await sync.syncTallyMessage(TALLY_INPUT);

  assert.equal(result.action, "created");
  assert.equal(sp.calls.create[0].DesiredProductCode, "WILL_ONLY");
  assert.equal(sp.calls.create[0].Stage, "New Inquiry");
  assert.equal(sp.calls.create[0].Source, "Website Message");
});

test("syncTallyMessage updates the single existing open item without touching Stage", async () => {
  const sp = fakeSharepointClient({
    findOpenItemByEmail: async () => [
      {
        id: "1",
        fields: {
          TallySubmissionID: "old-sub",
          InquiryReceivedAt: "2026-01-01T00:00:00Z",
        },
      },
    ],
  });
  const sync = createPipelineSync({ sharepointClient: sp });

  const result = await sync.syncTallyMessage(TALLY_INPUT);

  assert.equal(result.action, "updated");
  assert.equal(sp.calls.update[0].itemId, "1");
  assert.equal("Stage" in sp.calls.update[0].fields, false);
});

test("syncTallyMessage is a no-op on re-delivery of the same submissionId", async () => {
  const sp = fakeSharepointClient({
    findOpenItemByEmail: async () => [
      {
        id: "1",
        fields: {
          TallySubmissionID: "sub-1",
          InquiryReceivedAt: "2026-01-01T00:00:00Z",
        },
      },
    ],
  });
  const sync = createPipelineSync({ sharepointClient: sp });

  const result = await sync.syncTallyMessage(TALLY_INPUT);

  assert.equal(result.action, "no-op-duplicate");
  assert.equal(sp.calls.update.length, 0);
  assert.equal(sp.calls.create.length, 0);
});

test("syncTallyMessage flags multiple open matches on the newest row instead of guessing", async () => {
  const sp = fakeSharepointClient({
    findOpenItemByEmail: async () => [
      {
        id: "1",
        fields: { InquiryReceivedAt: "2026-01-01T00:00:00Z", Notes: "" },
      },
      {
        id: "2",
        fields: { InquiryReceivedAt: "2026-02-01T00:00:00Z", Notes: "" },
      },
    ],
  });
  const sync = createPipelineSync({ sharepointClient: sp });

  const result = await sync.syncTallyMessage(TALLY_INPUT);

  assert.equal(result.action, "flagged-multiple");
  assert.equal(sp.calls.update[0].itemId, "2");
  assert.match(sp.calls.update[0].fields.Notes, /NEEDS REVIEW/);
  assert.equal(sp.calls.create.length, 0);
});

const CALENDLY_BOOKING_INPUT = {
  eventUri: "https://api.calendly.com/scheduled_events/abc/invitees/def",
  name: "Jane Doe",
  email: "jane@example.com",
  startTime: "2026-08-01T18:00:00.000Z",
  endTime: "2026-08-01T18:30:00.000Z",
  timeZone: "America/Los_Angeles",
  cancelUrl: "https://calendly.com/cancellations/def",
  rescheduleUrl: "https://calendly.com/reschedulings/def",
};

test("syncCalendlyBooking creates a new row with Stage Consult Scheduled", async () => {
  const sp = fakeSharepointClient();
  const sync = createPipelineSync({ sharepointClient: sp });

  const result = await sync.syncCalendlyBooking(CALENDLY_BOOKING_INPUT);

  assert.equal(result.action, "created");
  assert.equal(sp.calls.create[0].Stage, "Consult Scheduled");
  assert.equal(
    sp.calls.create[0].CalendlyEventURI,
    CALENDLY_BOOKING_INPUT.eventUri,
  );
  assert.equal(sp.calls.create[0].FirstName, "Jane");
  assert.equal(sp.calls.create[0].LastName, "Doe");
});

test("syncCalendlyBooking is a no-op on re-delivery of the same eventUri", async () => {
  const sp = fakeSharepointClient({
    findOpenItemByEmail: async () => [
      {
        id: "1",
        fields: {
          CalendlyEventURI: CALENDLY_BOOKING_INPUT.eventUri,
          InquiryReceivedAt: "2026-01-01T00:00:00Z",
        },
      },
    ],
  });
  const sync = createPipelineSync({ sharepointClient: sp });

  const result = await sync.syncCalendlyBooking(CALENDLY_BOOKING_INPUT);

  assert.equal(result.action, "no-op-duplicate");
  assert.equal(sp.calls.update.length, 0);
});

test("syncCalendlyCancellation matches by CalendlyEventURI, not email", async () => {
  const sp = fakeSharepointClient({
    findItemByCalendlyEventUri: async (uri) =>
      uri === "https://api.calendly.com/x" ? { id: "1", fields: {} } : null,
  });
  const sync = createPipelineSync({ sharepointClient: sp });

  const result = await sync.syncCalendlyCancellation({
    eventUri: "https://api.calendly.com/x",
  });

  assert.equal(result.action, "cancelled");
  assert.equal(sp.calls.update[0].fields.Stage, "Consult Cancelled");
});

test("syncCalendlyCancellation is a safe no-op when no item matches", async () => {
  const sp = fakeSharepointClient();
  const sync = createPipelineSync({ sharepointClient: sp });

  const result = await sync.syncCalendlyCancellation({
    eventUri: "https://api.calendly.com/unknown",
  });

  assert.equal(result.action, "no-matching-item");
  assert.equal(sp.calls.update.length, 0);
});

test("a Graph failure rejects the promise instead of silently succeeding", async () => {
  const sp = fakeSharepointClient();
  sp.findOpenItemByEmail = async () => {
    throw new Error("[graph] GET /sites/x/lists/y/items failed: 403 Forbidden");
  };
  const sync = createPipelineSync({ sharepointClient: sp });

  await assert.rejects(() => sync.syncTallyMessage(TALLY_INPUT), /403/);
});
