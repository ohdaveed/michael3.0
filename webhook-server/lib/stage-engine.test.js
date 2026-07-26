"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createStageEngine, buildEventKey } = require("./stage-engine");
const { createItemLock } = require("./pipeline-item-lock");

function fakeSharepoint({ deltaBatches = [], log = null } = {}) {
  const calls = { delta: [], updates: [] };
  let batch = 0;
  return {
    calls,
    fetchListDelta: async (deltaLink) => {
      calls.delta.push(deltaLink);
      const result = deltaBatches[batch] || {
        reset: false,
        items: [],
        deltaLink: "link-final",
      };
      batch += 1;
      return result;
    },
    updatePipelineItem: async (itemId, fields) => {
      calls.updates.push({ itemId, fields });
      if (log) log.push("update");
      return null;
    },
  };
}

function fakeActivity({
  existingKeys = [],
  recordThrows = false,
  log = null,
} = {}) {
  const calls = { lookups: [], records: [] };
  const keys = new Set(existingKeys);
  return {
    calls,
    findSuccessByEventKey: async (eventKey) => {
      calls.lookups.push(eventKey);
      return keys.has(eventKey) ? { id: "prior", fields: {} } : null;
    },
    recordActivity: async (record) => {
      calls.records.push(record);
      if (recordThrows) throw new Error("activity write failed");
      if (record.outcome === "Success") {
        keys.add(record.eventKey);
        if (log) log.push("record:Success");
      } else if (record.outcome === "Failed") {
        if (log) log.push("record:Failed");
      }
      return { id: "new" };
    },
  };
}

function fakeMailer({ throws = false, log = null } = {}) {
  const calls = [];
  return {
    calls,
    sendEmail: async (input) => {
      calls.push(input);
      if (log && input.subject.includes("Consult held")) log.push("email");
      if (throws) throw new Error("mail send failed");
    },
  };
}

function makeEngine({ sharepoint, activity, mailer, log = null } = {}) {
  const sp = sharepoint || fakeSharepoint({ log });
  const act = activity || fakeActivity({ log });
  const mail = mailer || fakeMailer({ log });
  const engine = createStageEngine({
    sharepointClient: sp,
    activityClient: act,
    itemLock: createItemLock(),
    mailer: mail,
    michaelEmail: "michael@example.com",
  });
  return { engine, sp, act, mail };
}

const CONSULT_HELD_ITEM = {
  id: "42",
  webUrl: "https://tenant.sharepoint.com/item/42",
  fields: {
    Stage: "Consult Held",
    PreviousStage: "Consult Scheduled",
    FirstName: "Jane",
    LastName: "Doe",
    Email: "jane@example.com",
  },
};

test("buildEventKey combines item id, stage, and timeline version (defaulting to 0)", () => {
  assert.equal(
    buildEventKey("42", { Stage: "Consult Held" }),
    "42|Consult Held|0",
  );
  assert.equal(
    buildEventKey("42", { Stage: "Consult Held", TimelineVersion: 3 }),
    "42|Consult Held|3",
  );
});

test("self-update guard: Stage === PreviousStage runs no case handler at all", async () => {
  const { engine, act, mail, sp } = makeEngine();

  const result = await engine.processItem({
    id: "42",
    fields: { Stage: "Consult Held", PreviousStage: "Consult Held" },
  });

  assert.equal(result.action, "skip");
  assert.equal(act.calls.lookups.length, 0);
  assert.equal(mail.calls.length, 0);
  assert.equal(sp.calls.updates.length, 0);
});

test("Consult Held success path: email, Success record, then PreviousStage advance", async () => {
  const { engine, act, mail, sp } = makeEngine();

  const result = await engine.processItem(CONSULT_HELD_ITEM);

  assert.equal(result.action, "processed");
  assert.equal(mail.calls.length, 1);
  assert.match(mail.calls[0].subject, /Consult held/i);
  assert.match(mail.calls[0].text, /Jane Doe/);

  assert.equal(act.calls.records.length, 1);
  assert.equal(act.calls.records[0].outcome, "Success");
  assert.equal(act.calls.records[0].eventKey, "42|Consult Held|0");

  assert.equal(sp.calls.updates.length, 1);
  assert.equal(sp.calls.updates[0].itemId, "42");
  assert.equal(sp.calls.updates[0].fields.PreviousStage, "Consult Held");
  assert.match(
    sp.calls.updates[0].fields.StageChangedAt,
    /^\d{4}-\d{2}-\d{2}T/,
  );
});

test("success-path ordering: email, then Success record, then PreviousStage advance", async () => {
  const log = [];
  const { engine } = makeEngine({ log });

  await engine.processItem(CONSULT_HELD_ITEM);

  assert.deepEqual(log, ["email", "record:Success", "update"]);
});

test("double event: an already-recorded eventKey is a no-op with no second run", async () => {
  const { engine, act, mail, sp } = makeEngine({
    activity: fakeActivity({ existingKeys: ["42|Consult Held|0"] }),
  });

  const result = await engine.processItem(CONSULT_HELD_ITEM);

  assert.equal(result.action, "no-op-duplicate");
  assert.equal(mail.calls.length, 0);
  assert.equal(sp.calls.updates.length, 1);
  assert.equal(sp.calls.updates[0].fields.PreviousStage, "Consult Held");
  assert.equal(act.calls.records.length, 0);
});

test("processing twice through the engine only acts once", async () => {
  const { engine, mail } = makeEngine();

  await engine.processItem(CONSULT_HELD_ITEM);
  const second = await engine.processItem(CONSULT_HELD_ITEM);

  assert.equal(second.action, "no-op-duplicate");
  assert.equal(mail.calls.length, 1);
});

test("no-op-duplicate with unadvanced PreviousStage re-attempts the advance", async () => {
  const { engine, sp } = makeEngine({
    activity: fakeActivity({ existingKeys: ["42|Consult Held|0"] }),
  });

  const result = await engine.processItem(CONSULT_HELD_ITEM);

  assert.equal(result.action, "no-op-duplicate");
  assert.equal(sp.calls.updates.length, 1);
  assert.equal(sp.calls.updates[0].itemId, "42");
  assert.equal(sp.calls.updates[0].fields.PreviousStage, "Consult Held");
});

test("self-update guard still makes zero update calls", async () => {
  const { engine, sp } = makeEngine();

  await engine.processItem({
    id: "42",
    fields: { Stage: "Consult Held", PreviousStage: "Consult Held" },
  });

  assert.equal(sp.calls.updates.length, 0);
});

test("a stage with no handler is left untouched", async () => {
  const { engine, act, mail, sp } = makeEngine();

  const result = await engine.processItem({
    id: "42",
    fields: { Stage: "New Inquiry", PreviousStage: "" },
  });

  assert.equal(result.action, "unhandled");
  assert.equal(act.calls.lookups.length, 0);
  assert.equal(mail.calls.length, 0);
  assert.equal(sp.calls.updates.length, 0);
});

test("partial failure: handler error records Failed, never Success, and does not advance PreviousStage", async () => {
  const { engine, act, sp } = makeEngine({
    mailer: fakeMailer({ throws: true }),
  });

  const result = await engine.processItem(CONSULT_HELD_ITEM);

  assert.equal(result.action, "failed");
  const outcomes = act.calls.records.map((r) => r.outcome);
  assert.deepEqual(outcomes, ["Failed"]);
  assert.match(act.calls.records[0].errorDetails, /mail send failed/);
  assert.equal(sp.calls.updates.length, 0);
});

test("processNotifications continues past a failing item and returns all outcomes", async () => {
  const sp = fakeSharepoint({
    deltaBatches: [
      {
        reset: false,
        items: [
          {
            id: "1",
            fields: {
              Stage: "Consult Held",
              PreviousStage: "Consult Scheduled",
            },
          },
          {
            id: "2",
            fields: {
              Stage: "Consult Held",
              PreviousStage: "Consult Scheduled",
            },
          },
        ],
        deltaLink: "link-1",
      },
    ],
  });
  const { engine } = makeEngine({
    sharepoint: sp,
    mailer: fakeMailer({ throws: true }),
  });

  const outcomes = await engine.processNotifications();

  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].action, "failed");
  assert.equal(outcomes[0].itemId, "1");
  assert.equal(outcomes[1].action, "failed");
  assert.equal(outcomes[1].itemId, "2");
});

test("processNotifications catches a failure that escapes processItem (recordActivity throws inside the Failed path) and still processes the rest of the batch", async () => {
  const sp = fakeSharepoint({
    deltaBatches: [
      {
        reset: false,
        items: [
          {
            id: "1",
            fields: {
              Stage: "Consult Held",
              PreviousStage: "Consult Scheduled",
            },
          },
          {
            id: "2",
            fields: {
              Stage: "Consult Held",
              PreviousStage: "Consult Scheduled",
            },
          },
        ],
        deltaLink: "link-1",
      },
    ],
  });
  const { engine } = makeEngine({
    sharepoint: sp,
    activity: fakeActivity({ recordThrows: true }),
    mailer: fakeMailer({ throws: true }),
  });

  const outcomes = await engine.processNotifications();

  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].action, "error");
  assert.equal(outcomes[0].itemId, "1");
  assert.match(outcomes[0].error, /activity write failed/);
  assert.equal(outcomes[1].action, "error");
  assert.equal(outcomes[1].itemId, "2");
});

test("processNotifications stores the deltaLink between calls", async () => {
  const sp = fakeSharepoint({
    deltaBatches: [
      { reset: false, items: [], deltaLink: "link-1" },
      { reset: false, items: [], deltaLink: "link-2" },
    ],
  });
  const { engine } = makeEngine({ sharepoint: sp });

  await engine.processNotifications();
  await engine.processNotifications();

  assert.deepEqual(sp.calls.delta, [null, "link-1"]);
});

test("processNotifications restarts from a fresh baseline on delta reset", async () => {
  const sp = fakeSharepoint({
    deltaBatches: [
      { reset: true, items: [], deltaLink: null },
      { reset: false, items: [CONSULT_HELD_ITEM], deltaLink: "link-new" },
    ],
  });
  const { engine, mail } = makeEngine({ sharepoint: sp });

  const outcomes = await engine.processNotifications();

  assert.deepEqual(sp.calls.delta, [null, null]);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].action, "processed");
  assert.equal(mail.calls.length, 1);
});
