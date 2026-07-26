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

test("fetchListDelta without a link starts a fresh delta with fields expanded", async () => {
  const graphClient = fakeGraphClient(() => ({
    value: [{ id: "1", fields: { Stage: "Consult Held" } }],
    "@odata.deltaLink":
      "https://graph.microsoft.com/v1.0/sites/s/lists/l/items/delta?token=abc",
  }));
  const sp = createSharepointClient({ graphClient });

  const result = await sp.fetchListDelta(null);

  assert.equal(result.reset, false);
  assert.equal(result.items.length, 1);
  assert.match(result.deltaLink, /items\/delta\?token=abc/);
  assert.match(graphClient.calls[0].path, /\/items\/delta\?expand=fields/);
});

test("fetchListDelta follows nextLink pages and accumulates items", async () => {
  let call = 0;
  const graphClient = fakeGraphClient(() => {
    call += 1;
    if (call === 1) {
      return {
        value: [{ id: "1" }],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/sites/s/lists/l/items/delta?$skiptoken=page2",
      };
    }
    return {
      value: [{ id: "2" }],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/sites/s/lists/l/items/delta?token=final",
    };
  });
  const sp = createSharepointClient({ graphClient });

  const result = await sp.fetchListDelta(null);

  assert.deepEqual(
    result.items.map((i) => i.id),
    ["1", "2"],
  );
  assert.match(result.deltaLink, /token=final/);
  assert.match(graphClient.calls[1].path, /skiptoken=page2/);
  assert.ok(!graphClient.calls[1].path.startsWith("https://"));
});

test("fetchListDelta resumes from a stored deltaLink, stripping the Graph origin", async () => {
  const graphClient = fakeGraphClient(() => ({
    value: [],
    "@odata.deltaLink":
      "https://graph.microsoft.com/v1.0/sites/s/lists/l/items/delta?token=next",
  }));
  const sp = createSharepointClient({ graphClient });

  await sp.fetchListDelta(
    "https://graph.microsoft.com/v1.0/sites/s/lists/l/items/delta?token=prev",
  );

  assert.equal(
    graphClient.calls[0].path,
    "/sites/s/lists/l/items/delta?token=prev",
  );
});

test("fetchListDelta reports reset on 410 Gone instead of throwing", async () => {
  const graphClient = fakeGraphClient(() => {
    throw new Error(
      "[graph] GET /sites/s/lists/l/items/delta?token=stale failed: 410 resyncRequired",
    );
  });
  const sp = createSharepointClient({ graphClient });

  const result = await sp.fetchListDelta(
    "https://graph.microsoft.com/v1.0/sites/s/lists/l/items/delta?token=stale",
  );

  assert.deepEqual(result, { reset: true, items: [], deltaLink: null });
});

test("fetchListDelta rethrows non-410 errors", async () => {
  const graphClient = fakeGraphClient(() => {
    throw new Error("[graph] GET /x failed: 503 unavailable");
  });
  const sp = createSharepointClient({ graphClient });

  await assert.rejects(() => sp.fetchListDelta(null), /503/);
});
