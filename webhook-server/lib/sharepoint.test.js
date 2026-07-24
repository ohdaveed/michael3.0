"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSharepointClient } = require("./sharepoint");

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

test("findOpenItemByEmail filters by email and excludes closed stages", async () => {
  const graphClient = fakeGraphClient(() => ({
    value: [{ id: "1", fields: { Email: "a@b.com" } }],
  }));
  const sp = createSharepointClient({ graphClient });

  const items = await sp.findOpenItemByEmail("a@b.com");

  assert.equal(items.length, 1);
  const decodedPath = decodeURIComponent(graphClient.calls[0].path);
  assert.match(decodedPath, /fields\/Email eq 'a@b\.com'/);
  assert.match(decodedPath, /Stage ne 'Complete'/);
  assert.match(decodedPath, /Stage ne 'Declined'/);
  assert.match(decodedPath, /Stage ne 'Not a Fit'/);
  assert.match(decodedPath, /Stage ne 'No Response'/);
});

test("findOpenItemByEmail escapes single quotes in the email", async () => {
  const graphClient = fakeGraphClient(() => ({ value: [] }));
  const sp = createSharepointClient({ graphClient });

  await sp.findOpenItemByEmail("o'brien@example.com");

  const decodedPath = decodeURIComponent(graphClient.calls[0].path);
  assert.match(decodedPath, /o''brien@example\.com/);
});

test("findOpenItemByEmail sends the non-indexed-query Prefer header", async () => {
  const graphClient = fakeGraphClient(() => ({ value: [] }));
  const sp = createSharepointClient({ graphClient });

  await sp.findOpenItemByEmail("a@b.com");

  assert.equal(
    graphClient.calls[0].options.headers.Prefer,
    "HonorNonIndexedQueriesWarningMayFailRandomly",
  );
});

test("findItemByCalendlyEventUri returns the matching item", async () => {
  const graphClient = fakeGraphClient(() => ({
    value: [
      { id: "9", fields: { CalendlyEventURI: "https://api.calendly.com/x" } },
    ],
  }));
  const sp = createSharepointClient({ graphClient });

  const item = await sp.findItemByCalendlyEventUri(
    "https://api.calendly.com/x",
  );

  assert.equal(item.id, "9");
});

test("findItemByCalendlyEventUri returns null when nothing matches", async () => {
  const graphClient = fakeGraphClient(() => ({ value: [] }));
  const sp = createSharepointClient({ graphClient });

  const item = await sp.findItemByCalendlyEventUri(
    "https://api.calendly.com/unknown",
  );

  assert.equal(item, null);
});

test("createPipelineItem POSTs fields wrapped in a `fields` object", async () => {
  const graphClient = fakeGraphClient(() => ({ id: "42" }));
  const sp = createSharepointClient({ graphClient });

  const result = await sp.createPipelineItem({ Title: "Doe, Jane" });

  assert.equal(result.id, "42");
  assert.equal(graphClient.calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(graphClient.calls[0].options.body), {
    fields: { Title: "Doe, Jane" },
  });
});

test("updatePipelineItem PATCHes fields flat, not wrapped", async () => {
  const graphClient = fakeGraphClient(() => null);
  const sp = createSharepointClient({ graphClient });

  await sp.updatePipelineItem("42", { Stage: "Consult Scheduled" });

  assert.equal(
    graphClient.calls[0].path,
    "/sites/undefined/lists/undefined/items/42/fields",
  );
  assert.equal(graphClient.calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(graphClient.calls[0].options.body), {
    Stage: "Consult Scheduled",
  });
});
