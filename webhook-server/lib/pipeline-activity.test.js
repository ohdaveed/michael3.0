"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPipelineActivityClient } = require("./pipeline-activity");

function fakeGraphClient(responder) {
  const calls = [];
  return {
    calls,
    graphFetch: async (path, options = {}) => {
      calls.push({ path, options });
      return responder(path, options);
    },
  };
}

test("findSuccessByEventKey filters on EventKey and Outcome eq Success", async () => {
  const graphClient = fakeGraphClient(() => ({
    value: [{ id: "7", fields: { EventKey: "1|Consult Held|0" } }],
  }));
  const activity = createPipelineActivityClient({
    graphClient,
    siteId: "site",
    listId: "list",
  });

  const item = await activity.findSuccessByEventKey("1|Consult Held|0");

  assert.equal(item.id, "7");
  const decodedPath = decodeURIComponent(graphClient.calls[0].path);
  assert.match(decodedPath, /fields\/EventKey eq '1\|Consult Held\|0'/);
  assert.match(decodedPath, /fields\/Outcome eq 'Success'/);
  assert.equal(
    graphClient.calls[0].options.headers.Prefer,
    "HonorNonIndexedQueriesWarningMayFailRandomly",
  );
});

test("findSuccessByEventKey returns null when nothing matches", async () => {
  const graphClient = fakeGraphClient(() => ({ value: [] }));
  const activity = createPipelineActivityClient({
    graphClient,
    siteId: "site",
    listId: "list",
  });

  assert.equal(await activity.findSuccessByEventKey("x|y|0"), null);
});

test("findSuccessByEventKey escapes single quotes in the event key", async () => {
  const graphClient = fakeGraphClient(() => ({ value: [] }));
  const activity = createPipelineActivityClient({
    graphClient,
    siteId: "site",
    listId: "list",
  });

  await activity.findSuccessByEventKey("1|O'Brien stage|0");

  const decodedPath = decodeURIComponent(graphClient.calls[0].path);
  assert.match(decodedPath, /O''Brien/);
});

test("recordActivity POSTs a wrapped fields object with the audit columns", async () => {
  const graphClient = fakeGraphClient(() => ({ id: "99" }));
  const activity = createPipelineActivityClient({
    graphClient,
    siteId: "site",
    listId: "list",
  });

  const result = await activity.recordActivity({
    pipelineItemId: "42",
    eventType: "stage:Consult Held",
    eventKey: "42|Consult Held|0",
    summary: 'Stage "Consult Held" processed',
    outcome: "Success",
  });

  assert.equal(result.id, "99");
  const call = graphClient.calls[0];
  assert.equal(call.path, "/sites/site/lists/list/items");
  assert.equal(call.options.method, "POST");
  const body = JSON.parse(call.options.body);
  assert.equal(body.fields.Title, 'Stage "Consult Held" processed');
  assert.equal(body.fields.PipelineItemLookupId, 42);
  assert.equal(body.fields.EventType, "stage:Consult Held");
  assert.equal(body.fields.EventSource, "webhook-server");
  assert.equal(body.fields.ActorOrFlow, "stage-engine");
  assert.equal(body.fields.EventKey, "42|Consult Held|0");
  assert.equal(body.fields.Outcome, "Success");
  assert.equal(body.fields.ErrorDetails, "");
  assert.match(body.fields.EventTimestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("recordActivity includes errorDetails on failure records", async () => {
  const graphClient = fakeGraphClient(() => ({ id: "100" }));
  const activity = createPipelineActivityClient({
    graphClient,
    siteId: "site",
    listId: "list",
  });

  await activity.recordActivity({
    pipelineItemId: "42",
    eventType: "stage:Consult Held",
    eventKey: "42|Consult Held|0",
    summary: "failed",
    outcome: "Failed",
    errorDetails: "Graph 503",
  });

  const body = JSON.parse(graphClient.calls[0].options.body);
  assert.equal(body.fields.Outcome, "Failed");
  assert.equal(body.fields.ErrorDetails, "Graph 503");
});
