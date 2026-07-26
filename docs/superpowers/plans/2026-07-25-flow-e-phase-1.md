# Flow E Phase 1 — Stage Engine Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Flow E Phase 1 per `docs/superpowers/specs/2026-07-24-flow-e-stage-engine-design.md` §8: Graph change-notification subscription infrastructure, the `/webhooks/graph-pipeline` fast-ack handler, EventKey idempotency against the Pipeline Activity list, the per-item lock, the `Consult Held` case (questionnaire-send stubbed as an email to Michael), and wiring `webhook-server`'s existing `npm test` into CI.

**Architecture:** All code lives in `webhook-server` (Node 18+, Express, zero new dependencies), following the existing factory-function/injectable-deps convention. Graph list notifications carry no data, so every notification triggers a delta query; a `Stage` vs `PreviousStage` comparison detects real transitions and guards against self-triggered notification loops; the durable idempotency guarantee is an `EventKey` check against the `Pipeline Activity` SharePoint list, with an in-process per-item lock as a race-reduction optimization.

**Tech Stack:** Node 18+ built-ins (`node:test`, `node:assert/strict`, `crypto`), Express 4 (already present), Microsoft Graph v1.0 REST.

## Global Constraints

- CommonJS, `"use strict";` at top of every file — matches every existing `webhook-server` file.
- File naming is kebab-case (`pipeline-sync.js`, `graph-client.js`) — the spec's camelCase names map to: `lib/subscriptions.js`, `lib/pipeline-activity.js`, `lib/pipeline-item-lock.js`, `lib/stage-engine.js`.
- No new npm dependencies. Tests use `node:test` + fake clients with recorded `calls` arrays (see `lib/sharepoint.test.js` for the house pattern).
- All secrets/IDs come from env vars (Railway), never committed. New env vars: `GRAPH_SUBSCRIPTION_CLIENT_STATE`, `GRAPH_NOTIFICATION_URL`, `SHAREPOINT_ACTIVITY_LIST_ID`.
- Constant-time comparison for `clientState` via `crypto.timingSafeEqual` on SHA-256 hashes of both sides (hashing gives equal-length buffers; `timingSafeEqual` throws on length mismatch).
- Webhook handlers respond before doing Graph work (fast-ack pattern, see `/webhooks/tally`); background work is a `.catch()`-guarded async IIFE.
- Run tests from `webhook-server/`: `npm test` (runs `node --test lib/*.test.js server.test.js`). New test files matching `lib/*.test.js` are picked up automatically.
- Commit after each task (repo convention: `feat(webhook-server): ...` / `chore(ci): ...`), ending commit messages with the Claude co-author trailer.
- `eventKey` format: `` `${itemId}|${fields.Stage}|${fields.TimelineVersion ?? 0}` `` — `TimelineVersion` may not exist on the list yet; `?? 0` tolerates that.

---

### Task 1: Per-item lock — `lib/pipeline-item-lock.js`

**Files:**

- Create: `webhook-server/lib/pipeline-item-lock.js`
- Test: `webhook-server/lib/pipeline-item-lock.test.js`

**Interfaces:**

- Consumes: nothing (pure, no deps).
- Produces: `createItemLock()` → `{ withItemLock(itemId, fn) }`. `withItemLock` returns a promise resolving/rejecting with `fn`'s result; calls for the same `itemId` run strictly in sequence; a rejection does not block the next queued call; different ids are unserialized.

- [ ] **Step 1: Write the failing tests**

```js
// webhook-server/lib/pipeline-item-lock.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createItemLock } = require("./pipeline-item-lock");

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("two calls for the same item run strictly in sequence", async () => {
  const lock = createItemLock();
  const events = [];
  const gate = deferred();

  const first = lock.withItemLock("42", async () => {
    events.push("first-start");
    await gate.promise;
    events.push("first-end");
  });
  const second = lock.withItemLock("42", async () => {
    events.push("second-start");
  });

  // Give the second call every chance to start early if the lock is broken.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events, ["first-start"]);

  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
});

test("different items are not serialized against each other", async () => {
  const lock = createItemLock();
  const events = [];
  const gate = deferred();

  const a = lock.withItemLock("a", async () => {
    await gate.promise;
    events.push("a");
  });
  const b = lock.withItemLock("b", async () => {
    events.push("b");
  });

  await b;
  assert.deepEqual(events, ["b"]);
  gate.resolve();
  await a;
});

test("a rejection does not block the next queued call", async () => {
  const lock = createItemLock();
  const failing = lock.withItemLock("42", async () => {
    throw new Error("boom");
  });
  const next = lock.withItemLock("42", async () => "ran");

  await assert.rejects(failing, /boom/);
  assert.equal(await next, "ran");
});

test("returns the wrapped function's resolved value", async () => {
  const lock = createItemLock();
  assert.equal(await lock.withItemLock("42", async () => "value"), "value");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webhook-server/`): `node --test lib/pipeline-item-lock.test.js`
Expected: FAIL — `Cannot find module './pipeline-item-lock'`

- [ ] **Step 3: Write the implementation**

```js
// webhook-server/lib/pipeline-item-lock.js
"use strict";

// In-process per-item mutex: chains async work for the same Client
// Pipeline item id so overlapping processing runs strictly one after
// another. This is a race-reduction optimization only — the map is empty
// after a process restart and does nothing across replicas; the durable
// correctness guarantee is the Pipeline Activity EventKey check (see
// lib/stage-engine.js).
function createItemLock() {
  const chains = new Map(); // itemId -> settled tail promise

  function withItemLock(itemId, fn) {
    const tail = chains.get(itemId) || Promise.resolve();
    const next = tail.then(() => fn());
    const settled = next.then(
      () => {},
      () => {},
    );
    chains.set(itemId, settled);
    settled.then(() => {
      if (chains.get(itemId) === settled) chains.delete(itemId);
    });
    return next;
  }

  return { withItemLock };
}

module.exports = { createItemLock };
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `webhook-server/`): `node --test lib/pipeline-item-lock.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the whole suite, then commit**

Run (from `webhook-server/`): `npm test` — expected: all pass.

```bash
git add webhook-server/lib/pipeline-item-lock.js webhook-server/lib/pipeline-item-lock.test.js
git commit -m "feat(webhook-server): per-item lock for pipeline item serialization"
```

---

### Task 2: Pipeline Activity client — `lib/pipeline-activity.js`

**Files:**

- Create: `webhook-server/lib/pipeline-activity.js`
- Test: `webhook-server/lib/pipeline-activity.test.js`

**Interfaces:**

- Consumes: `graphClient.graphFetch(path, options)` from `lib/graph-client.js` (injected; tests use the `fakeGraphClient(responder)` pattern from `lib/sharepoint.test.js`).
- Produces: `createPipelineActivityClient({ graphClient, siteId, listId })` → `{ findSuccessByEventKey(eventKey), recordActivity({ pipelineItemId, eventType, eventKey, summary, outcome, errorDetails }) }`. `findSuccessByEventKey` returns the matching list item or `null`. `recordActivity` returns the created item.

**Column-name caveat:** the live `Pipeline Activity` list was built 2026-07-24 to match `client-pipeline.md` §4.2 (`EventType`, `EventSource`, `EventTimestamp`, `ActorOrFlow`, `CorrelationID`, `EventKey`, `Summary`, `Outcome`, `ErrorDetails`, plus a lookup to the pipeline item). Internal Graph field names cannot be verified from this machine (no local `.env`). Keep every field name in one `FIELDS` constant so a deploy-time correction is a one-place edit, write the pipeline-item reference as a plain text `PipelineItemID` field (not the lookup — lookups need `<Field>LookupId` and the internal name is unverified), and list verification as a deploy-checklist step.

- [ ] **Step 1: Write the failing tests**

```js
// webhook-server/lib/pipeline-activity.test.js
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
  assert.equal(body.fields.PipelineItemID, "42");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webhook-server/`): `node --test lib/pipeline-activity.test.js`
Expected: FAIL — `Cannot find module './pipeline-activity'`

- [ ] **Step 3: Write the implementation**

```js
// webhook-server/lib/pipeline-activity.js
"use strict";

const { createGraphClient } = require("./graph-client");

// Client for the `Pipeline Activity` SharePoint list (client-pipeline.md
// §4.2) — the append-only audit trail and idempotency ledger. The stage
// engine checks EventKey here before acting and records every outcome.
//
// FIELDS maps our names to the list's internal column names. The live
// list was built to match §4.2, but internal names must be confirmed
// against GET /sites/{site}/lists/{list}/columns before first deploy
// (see webhook-server/README.md) — correct them here if they differ.
// The pipeline-item reference is written as plain text (PipelineItemID),
// not the §4.2 lookup column, until the lookup's internal name is
// confirmed (Graph lookups require the `<Field>LookupId` form).
const FIELDS = {
  title: "Title",
  pipelineItemId: "PipelineItemID",
  eventType: "EventType",
  eventSource: "EventSource",
  eventTimestamp: "EventTimestamp",
  actorOrFlow: "ActorOrFlow",
  eventKey: "EventKey",
  summary: "Summary",
  outcome: "Outcome",
  errorDetails: "ErrorDetails",
};

function createPipelineActivityClient({
  graphClient = createGraphClient(),
  siteId = process.env.SHAREPOINT_SITE_ID,
  listId = process.env.SHAREPOINT_ACTIVITY_LIST_ID,
} = {}) {
  async function findSuccessByEventKey(eventKey) {
    const escapedKey = eventKey.replace(/'/g, "''");
    const filterValue = `fields/${FIELDS.eventKey} eq '${escapedKey}' and fields/${FIELDS.outcome} eq 'Success'`;
    // encodeURIComponent (not URLSearchParams) — see lib/sharepoint.js for
    // why (`+` vs `%20` round-tripping).
    const encodedFilter = encodeURIComponent(filterValue);
    const path = `/sites/${siteId}/lists/${listId}/items?expand=fields&$filter=${encodedFilter}`;
    const data = await graphClient.graphFetch(path, {
      method: "GET",
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
    });
    return (data.value || [])[0] || null;
  }

  async function recordActivity({
    pipelineItemId,
    eventType,
    eventKey,
    summary,
    outcome,
    errorDetails = "",
  }) {
    return graphClient.graphFetch(`/sites/${siteId}/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          [FIELDS.title]: summary,
          [FIELDS.pipelineItemId]: String(pipelineItemId),
          [FIELDS.eventType]: eventType,
          [FIELDS.eventSource]: "webhook-server",
          [FIELDS.eventTimestamp]: new Date().toISOString(),
          [FIELDS.actorOrFlow]: "stage-engine",
          [FIELDS.eventKey]: eventKey,
          [FIELDS.summary]: summary,
          [FIELDS.outcome]: outcome,
          [FIELDS.errorDetails]: errorDetails,
        },
      }),
    });
  }

  return { findSuccessByEventKey, recordActivity };
}

module.exports = { createPipelineActivityClient };
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `webhook-server/`): `node --test lib/pipeline-activity.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the whole suite, then commit**

Run (from `webhook-server/`): `npm test` — expected: all pass.

```bash
git add webhook-server/lib/pipeline-activity.js webhook-server/lib/pipeline-activity.test.js
git commit -m "feat(webhook-server): Pipeline Activity client with EventKey idempotency lookup"
```

---

### Task 3: Subscription lifecycle — `lib/subscriptions.js`

**Files:**

- Create: `webhook-server/lib/subscriptions.js`
- Test: `webhook-server/lib/subscriptions.test.js`

**Interfaces:**

- Consumes: `graphClient.graphFetch(path, options)` (injected).
- Produces: `createSubscriptionsClient({ graphClient, siteId, listId, notificationUrl, clientState, now })` → `{ listActiveSubscriptions(), createSubscription(), renewSubscription(subscriptionId), ensureSubscription() }`. `ensureSubscription()` returns `{ action: "created", id }` or `{ action: "checked", subscriptions: [{ action: "renewed"|"ok", id }] }`.

- [ ] **Step 1: Write the failing tests**

```js
// webhook-server/lib/subscriptions.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSubscriptionsClient } = require("./subscriptions");

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

const BASE = {
  siteId: "site",
  listId: "list",
  notificationUrl: "https://example.up.railway.app/webhooks/graph-pipeline",
  clientState: "shh",
};
const T0 = Date.parse("2026-07-25T00:00:00Z");

test("createSubscription POSTs the list resource with clientState and a sub-30-day expiration", async () => {
  const graphClient = fakeGraphClient(() => ({ id: "sub-1" }));
  const subs = createSubscriptionsClient({
    graphClient,
    ...BASE,
    now: () => T0,
  });

  const created = await subs.createSubscription();

  assert.equal(created.id, "sub-1");
  const call = graphClient.calls[0];
  assert.equal(call.path, "/subscriptions");
  assert.equal(call.options.method, "POST");
  const body = JSON.parse(call.options.body);
  assert.equal(body.changeType, "updated");
  assert.equal(body.resource, "sites/site/lists/list");
  assert.equal(body.notificationUrl, BASE.notificationUrl);
  assert.equal(body.clientState, "shh");
  const lifetimeMinutes = (Date.parse(body.expirationDateTime) - T0) / 60_000;
  assert.ok(lifetimeMinutes > 40_000, "should use most of the window");
  assert.ok(lifetimeMinutes <= 42_300, "must not exceed Graph's cap");
});

test("listActiveSubscriptions returns only subscriptions for this list", async () => {
  const graphClient = fakeGraphClient(() => ({
    value: [
      { id: "ours", resource: "sites/site/lists/list" },
      { id: "other", resource: "sites/site/lists/other-list" },
    ],
  }));
  const subs = createSubscriptionsClient({ graphClient, ...BASE });

  const active = await subs.listActiveSubscriptions();

  assert.deepEqual(
    active.map((s) => s.id),
    ["ours"],
  );
});

test("ensureSubscription creates one when none exists", async () => {
  const graphClient = fakeGraphClient((path, options) =>
    options.method === "POST" ? { id: "sub-new" } : { value: [] },
  );
  const subs = createSubscriptionsClient({
    graphClient,
    ...BASE,
    now: () => T0,
  });

  const result = await subs.ensureSubscription();

  assert.deepEqual(result, { action: "created", id: "sub-new" });
});

test("ensureSubscription renews a subscription expiring within 48 hours", async () => {
  const expiringSoon = new Date(T0 + 24 * 60 * 60 * 1000).toISOString();
  const graphClient = fakeGraphClient((path, options) => {
    if (options.method === "PATCH") return { id: "sub-1" };
    return {
      value: [
        {
          id: "sub-1",
          resource: "sites/site/lists/list",
          expirationDateTime: expiringSoon,
        },
      ],
    };
  });
  const subs = createSubscriptionsClient({
    graphClient,
    ...BASE,
    now: () => T0,
  });

  const result = await subs.ensureSubscription();

  assert.deepEqual(result, {
    action: "checked",
    subscriptions: [{ action: "renewed", id: "sub-1" }],
  });
  const patch = graphClient.calls.find((c) => c.options.method === "PATCH");
  assert.equal(patch.path, "/subscriptions/sub-1");
  assert.ok(JSON.parse(patch.options.body).expirationDateTime);
});

test("ensureSubscription leaves a healthy subscription alone", async () => {
  const healthy = new Date(T0 + 20 * 24 * 60 * 60 * 1000).toISOString();
  const graphClient = fakeGraphClient(() => ({
    value: [
      {
        id: "sub-1",
        resource: "sites/site/lists/list",
        expirationDateTime: healthy,
      },
    ],
  }));
  const subs = createSubscriptionsClient({
    graphClient,
    ...BASE,
    now: () => T0,
  });

  const result = await subs.ensureSubscription();

  assert.deepEqual(result, {
    action: "checked",
    subscriptions: [{ action: "ok", id: "sub-1" }],
  });
  assert.equal(graphClient.calls.length, 1); // the GET only — no PATCH/POST
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webhook-server/`): `node --test lib/subscriptions.test.js`
Expected: FAIL — `Cannot find module './subscriptions'`

- [ ] **Step 3: Write the implementation**

```js
// webhook-server/lib/subscriptions.js
"use strict";

const { createGraphClient } = require("./graph-client");

// Microsoft Graph change-notification subscription lifecycle for the
// Client Pipeline list. SharePoint list subscriptions allow expirations up
// to 42,300 minutes (~30 days); we request slightly less and re-check on a
// half-day cadence (see server.js), renewing anything within 48 hours of
// expiry — including immediately on process start, so a Railway restart
// that slept through a renewal tick still recovers.
const MAX_LIFETIME_MINUTES = 42_000; // just under Graph's 42,300-minute cap
const RENEW_WITHIN_MS = 48 * 60 * 60 * 1000;

function createSubscriptionsClient({
  graphClient = createGraphClient(),
  siteId = process.env.SHAREPOINT_SITE_ID,
  listId = process.env.SHAREPOINT_LIST_ID,
  notificationUrl = process.env.GRAPH_NOTIFICATION_URL,
  clientState = process.env.GRAPH_SUBSCRIPTION_CLIENT_STATE,
  now = () => Date.now(),
} = {}) {
  const resource = `sites/${siteId}/lists/${listId}`;

  function expirationFromNow() {
    return new Date(now() + MAX_LIFETIME_MINUTES * 60_000).toISOString();
  }

  async function listActiveSubscriptions() {
    const data = await graphClient.graphFetch("/subscriptions", {
      method: "GET",
    });
    return (data.value || []).filter((s) => s.resource === resource);
  }

  async function createSubscription() {
    return graphClient.graphFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "updated",
        notificationUrl,
        resource,
        expirationDateTime: expirationFromNow(),
        clientState,
      }),
    });
  }

  async function renewSubscription(subscriptionId) {
    return graphClient.graphFetch(`/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime: expirationFromNow() }),
    });
  }

  // Idempotent: creates a subscription if none exists for the list, renews
  // any expiring within RENEW_WITHIN_MS, leaves healthy ones alone.
  async function ensureSubscription() {
    const subs = await listActiveSubscriptions();
    if (subs.length === 0) {
      const created = await createSubscription();
      return { action: "created", id: created.id };
    }
    const results = [];
    for (const sub of subs) {
      const msLeft = Date.parse(sub.expirationDateTime) - now();
      if (msLeft < RENEW_WITHIN_MS) {
        await renewSubscription(sub.id);
        results.push({ action: "renewed", id: sub.id });
      } else {
        results.push({ action: "ok", id: sub.id });
      }
    }
    return { action: "checked", subscriptions: results };
  }

  return {
    listActiveSubscriptions,
    createSubscription,
    renewSubscription,
    ensureSubscription,
  };
}

module.exports = { createSubscriptionsClient };
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `webhook-server/`): `node --test lib/subscriptions.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the whole suite, then commit**

Run (from `webhook-server/`): `npm test` — expected: all pass.

```bash
git add webhook-server/lib/subscriptions.js webhook-server/lib/subscriptions.test.js
git commit -m "feat(webhook-server): Graph change-notification subscription lifecycle"
```

---

### Task 4: Delta query — extend `lib/sharepoint.js`

**Files:**

- Modify: `webhook-server/lib/sharepoint.js` (add `fetchListDelta` to the factory and its returned object)
- Modify: `webhook-server/lib/sharepoint.test.js` (append tests)

**Interfaces:**

- Consumes: the existing `graphClient.graphFetch` inside `createSharepointClient`. Note `graphFetch` errors carry the message shape `` `[graph] GET ${path} failed: ${status} ${body}` `` — the 410 detection matches `/failed: 410/` on that message.
- Produces: `sharepointClient.fetchListDelta(deltaLink)` → `{ reset: boolean, items: [], deltaLink: string|null }`. `deltaLink` argument is the absolute `@odata.deltaLink` URL from the previous call, or `null` for a full baseline sync. `reset: true` means Graph returned `410 Gone` (expired token) and the caller must restart from `null`.

- [ ] **Step 1: Write the failing tests** (append to `lib/sharepoint.test.js`; it already defines `fakeGraphClient`)

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webhook-server/`): `node --test lib/sharepoint.test.js`
Expected: FAIL — `sp.fetchListDelta is not a function`

- [ ] **Step 3: Implement** — inside `createSharepointClient`, after `updatePipelineItem`, add the function and export it in the returned object:

```js
// Delta query over the Client Pipeline list. Graph list-change
// notifications never include the changed data itself (resourceData is
// empty for list resources), so every notification triggers a delta
// fetch to learn what actually changed. Pass the deltaLink returned by
// the previous call to get only changes since then; pass null for a
// full baseline sync. `reset: true` signals a 410 Gone (expired delta
// token, a documented delta behavior) — the caller must restart from
// null.
const GRAPH_ORIGIN = "https://graph.microsoft.com/v1.0";

async function fetchListDelta(deltaLink) {
  const items = [];
  let path = deltaLink
    ? deltaLink.replace(GRAPH_ORIGIN, "")
    : `/sites/${SITE_ID}/lists/${LIST_ID}/items/delta?expand=fields`;
  for (;;) {
    let data;
    try {
      data = await graphClient.graphFetch(path, { method: "GET" });
    } catch (err) {
      if (/failed: 410\b/.test(String(err.message))) {
        return { reset: true, items: [], deltaLink: null };
      }
      throw err;
    }
    items.push(...(data.value || []));
    if (data["@odata.nextLink"]) {
      path = data["@odata.nextLink"].replace(GRAPH_ORIGIN, "");
    } else {
      return {
        reset: false,
        items,
        deltaLink: data["@odata.deltaLink"] || null,
      };
    }
  }
}
```

And change the return statement to:

```js
return {
  findOpenItemByEmail,
  findItemByCalendlyEventUri,
  createPipelineItem,
  updatePipelineItem,
  fetchListDelta,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `webhook-server/`): `node --test lib/sharepoint.test.js`
Expected: PASS (12 tests — 7 existing + 5 new)

- [ ] **Step 5: Run the whole suite, then commit**

Run (from `webhook-server/`): `npm test` — expected: all pass.

```bash
git add webhook-server/lib/sharepoint.js webhook-server/lib/sharepoint.test.js
git commit -m "feat(webhook-server): delta query support on the Client Pipeline list"
```

---

### Task 5: Stage engine — `lib/stage-engine.js`

**Files:**

- Create: `webhook-server/lib/stage-engine.js`
- Test: `webhook-server/lib/stage-engine.test.js`

**Interfaces:**

- Consumes:
  - `sharepointClient.fetchListDelta(deltaLink)` → `{ reset, items, deltaLink }` (Task 4)
  - `sharepointClient.updatePipelineItem(itemId, fields)` (existing)
  - `activityClient.findSuccessByEventKey(eventKey)` / `activityClient.recordActivity({...})` (Task 2)
  - `itemLock.withItemLock(itemId, fn)` (Task 1)
  - `mailer.sendEmail({ to, subject, text })` (existing `lib/mailer.js` shape)
- Produces: `createStageEngine({ sharepointClient, activityClient, itemLock, mailer, michaelEmail })` → `{ processNotifications(), processItem(item) }`, plus exported `buildEventKey(itemId, fields)`. `processNotifications()` returns an array of per-item outcome objects `{ action: "skip"|"unhandled"|"no-op-duplicate"|"processed"|"failed", itemId, ... }`. The engine holds the `deltaLink` in module state between calls (in-memory; a restart falls back to a full baseline sync, which is safe because the Stage/PreviousStage guard and EventKey check make reprocessing a no-op).

- [ ] **Step 1: Write the failing tests**

```js
// webhook-server/lib/stage-engine.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createStageEngine, buildEventKey } = require("./stage-engine");
const { createItemLock } = require("./pipeline-item-lock");

function fakeSharepoint({ deltaBatches = [] } = {}) {
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
      return null;
    },
  };
}

function fakeActivity({ existingKeys = [], recordThrows = false } = {}) {
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
      if (record.outcome === "Success") keys.add(record.eventKey);
      return { id: "new" };
    },
  };
}

function fakeMailer({ throws = false } = {}) {
  const calls = [];
  return {
    calls,
    sendEmail: async (input) => {
      calls.push(input);
      if (throws) throw new Error("mail send failed");
    },
  };
}

function makeEngine({ sharepoint, activity, mailer } = {}) {
  const sp = sharepoint || fakeSharepoint();
  const act = activity || fakeActivity();
  const mail = mailer || fakeMailer();
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

test("double event: an already-recorded eventKey is a no-op with no second run", async () => {
  const { engine, act, mail, sp } = makeEngine({
    activity: fakeActivity({ existingKeys: ["42|Consult Held|0"] }),
  });

  const result = await engine.processItem(CONSULT_HELD_ITEM);

  assert.equal(result.action, "no-op-duplicate");
  assert.equal(mail.calls.length, 0);
  assert.equal(sp.calls.updates.length, 0);
  assert.equal(act.calls.records.length, 0);
});

test("processing twice through the engine only acts once", async () => {
  const { engine, mail } = makeEngine();

  await engine.processItem(CONSULT_HELD_ITEM);
  const second = await engine.processItem(CONSULT_HELD_ITEM);

  assert.equal(second.action, "no-op-duplicate");
  assert.equal(mail.calls.length, 1);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webhook-server/`): `node --test lib/stage-engine.test.js`
Expected: FAIL — `Cannot find module './stage-engine'`

- [ ] **Step 3: Write the implementation**

```js
// webhook-server/lib/stage-engine.js
"use strict";

// Flow E — the stage engine
// (docs/superpowers/specs/2026-07-24-flow-e-stage-engine-design.md).
// Reacts to Client Pipeline changes surfaced by Graph change
// notifications: one delta fetch per notification batch, a Stage vs
// PreviousStage comparison to detect real transitions (and to no-op the
// self-triggered notification caused by this engine's own writes), an
// EventKey idempotency check against the Pipeline Activity list, then a
// per-stage handler. Phase 1 implements only the `Consult Held` case.

function buildEventKey(itemId, fields) {
  return `${itemId}|${fields.Stage}|${fields.TimelineVersion ?? 0}`;
}

function createStageEngine({
  sharepointClient,
  activityClient,
  itemLock,
  mailer,
  michaelEmail,
}) {
  // In-memory only: a restart falls back to a full baseline sync, which is
  // safe — the Stage/PreviousStage guard and EventKey check make
  // reprocessing old items a no-op.
  let deltaLink = null;

  // Consult Held (spec §4): the questionnaire send is stubbed as a manual
  // task for Michael — the intake Microsoft Form (gap G2) and the
  // where-to-file-responses question are unresolved, and the Matter Tasks
  // list does not exist yet, so the "intake reminder task" is delivered as
  // an email until those land.
  async function handleConsultHeld(item) {
    const f = item.fields;
    const name =
      `${f.FirstName || ""} ${f.LastName || ""}`.trim() ||
      f.Title ||
      `item ${item.id}`;
    await mailer.sendEmail({
      to: michaelEmail,
      subject: `[Pipeline] Consult held — send intake questionnaire to ${name}`,
      text: [
        `Stage moved to "Consult Held" for ${name} <${f.Email || "no email"}>.`,
        ``,
        `Action needed (automated questionnaire send not built yet — G2 pending):`,
        `  1. Send the intake questionnaire.`,
        `  2. Note it on the pipeline item once sent.`,
        ``,
        `Pipeline item: ${item.webUrl || `item ${item.id}`}`,
      ].join("\n"),
    });
  }

  // Later phases add cases here (Fee Agreement Sent, Engaged (Accepted),
  // Signing Scheduled, Signed & Paid, Declined / Not a Fit).
  const CASE_HANDLERS = {
    "Consult Held": handleConsultHeld,
  };

  async function processItem(item) {
    const fields = item.fields || {};
    // Self-update guard: equal means either nothing changed or this
    // engine's own last write already advanced PreviousStage (spec §2.1).
    if (!fields.Stage || fields.Stage === fields.PreviousStage) {
      return { action: "skip", itemId: item.id };
    }
    const handler = CASE_HANDLERS[fields.Stage];
    if (!handler) {
      return { action: "unhandled", itemId: item.id, stage: fields.Stage };
    }
    const eventKey = buildEventKey(item.id, fields);
    if (await activityClient.findSuccessByEventKey(eventKey)) {
      return { action: "no-op-duplicate", itemId: item.id, eventKey };
    }
    try {
      await handler(item);
    } catch (err) {
      // A partial failure must not write the Success record — the next
      // notification for this item retries the whole case.
      await activityClient.recordActivity({
        pipelineItemId: item.id,
        eventType: `stage:${fields.Stage}`,
        eventKey,
        summary: `Stage "${fields.Stage}" processing failed`,
        outcome: "Failed",
        errorDetails: String(err.message || err),
      });
      await mailer.sendEmail({
        to: michaelEmail,
        subject: `[ALERT] Stage engine failed — ${fields.Stage} (item ${item.id})`,
        text: [
          `Processing the "${fields.Stage}" stage failed for pipeline item ${item.id}.`,
          ``,
          `Error: ${err.message}`,
          ``,
          `Check Railway logs. The transition will retry on the next change`,
          `notification for this item.`,
        ].join("\n"),
      });
      return {
        action: "failed",
        itemId: item.id,
        eventKey,
        error: err.message,
      };
    }
    await activityClient.recordActivity({
      pipelineItemId: item.id,
      eventType: `stage:${fields.Stage}`,
      eventKey,
      summary: `Stage "${fields.Stage}" processed`,
      outcome: "Success",
    });
    // Last step: advance PreviousStage so the self-triggered notification
    // from this write sees Stage === PreviousStage and no-ops.
    await sharepointClient.updatePipelineItem(item.id, {
      PreviousStage: fields.Stage,
      StageChangedAt: new Date().toISOString(),
    });
    return { action: "processed", itemId: item.id, eventKey };
  }

  // Entry point for the webhook handler: one delta fetch per notification
  // batch (notifications carry no data), then per-item processing behind
  // the per-item lock.
  async function processNotifications() {
    let result = await sharepointClient.fetchListDelta(deltaLink);
    if (result.reset) {
      deltaLink = null;
      result = await sharepointClient.fetchListDelta(null);
    }
    deltaLink = result.deltaLink;
    const outcomes = [];
    for (const item of result.items) {
      outcomes.push(
        await itemLock.withItemLock(item.id, () => processItem(item)),
      );
    }
    return outcomes;
  }

  return { processNotifications, processItem };
}

module.exports = { createStageEngine, buildEventKey };
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `webhook-server/`): `node --test lib/stage-engine.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Run the whole suite, then commit**

Run (from `webhook-server/`): `npm test` — expected: all pass.

```bash
git add webhook-server/lib/stage-engine.js webhook-server/lib/stage-engine.test.js
git commit -m "feat(webhook-server): stage engine with Consult Held case and EventKey idempotency"
```

---

### Task 6: Webhook endpoint + startup wiring — `server.js`

**Files:**

- Modify: `webhook-server/server.js`
- Modify: `webhook-server/server.test.js` (append tests)
- Modify: `webhook-server/README.md` (document the new endpoint, env vars, and deploy checklist)

**Interfaces:**

- Consumes: `stageEngine.processNotifications()` (Task 5), `createSubscriptionsClient().ensureSubscription()` (Task 3), `createPipelineActivityClient` (Task 2), `createItemLock` (Task 1).
- Produces: `POST /webhooks/graph-pipeline` (validation echo / 401 on bad clientState / 202 + background processing); `createApp` gains `{ stageEngine, graphClientState }` options; startup gains the subscription bootstrap + 12-hour renewal interval, active only when `GRAPH_NOTIFICATION_URL` and `GRAPH_SUBSCRIPTION_CLIENT_STATE` are both set.

- [ ] **Step 1: Write the failing tests** (append to `server.test.js`; `withServer` already forwards `appOptions` into `createApp`)

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webhook-server/`): `node --test server.test.js`
Expected: FAIL — 404s (route doesn't exist) and unknown `createApp` options are ignored, so the new tests fail on status assertions.

- [ ] **Step 3: Implement in `server.js`**

3a. Add requires (after the existing `require` lines):

```js
const { createPipelineActivityClient } = require("./lib/pipeline-activity");
const { createSubscriptionsClient } = require("./lib/subscriptions");
const { createStageEngine } = require("./lib/stage-engine");
const { createItemLock } = require("./lib/pipeline-item-lock");
```

3b. Add config constants (in the Config section):

```js
// Flow E — Graph change notifications on the Client Pipeline list.
// Both must be set for the subscription bootstrap to run; the webhook
// route itself rejects everything (401) while the clientState is unset.
const GRAPH_CLIENT_STATE = process.env.GRAPH_SUBSCRIPTION_CLIENT_STATE || "";
const GRAPH_NOTIFICATION_URL = process.env.GRAPH_NOTIFICATION_URL || "";
```

3c. Add the clientState validator (next to `validateCalendlySignature`):

```js
// ---------------------------------------------------------------------------
// Graph clientState validation
// Graph echoes the subscription's clientState verbatim on every
// notification — a static shared secret, not an HMAC. Still compared
// constant-time (SHA-256 both sides so timingSafeEqual gets equal-length
// buffers), consistent with validateCalendlySignature's discipline.
// ---------------------------------------------------------------------------
function validateGraphClientState(notifications, expected) {
  if (!expected || notifications.length === 0) return false;
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return notifications.every((n) => {
    const gotHash = crypto
      .createHash("sha256")
      .update(String(n.clientState || ""))
      .digest();
    return crypto.timingSafeEqual(gotHash, expectedHash);
  });
}
```

3d. Add a default-builder (next to `buildDefaultPipelineSync`):

```js
// Flow E stage engine — shares one Graph client across the SharePoint,
// activity-ledger, and mail dependencies.
function buildDefaultStageEngine(mailer) {
  const graphClient = createGraphClient();
  return createStageEngine({
    sharepointClient: createSharepointClient({ graphClient }),
    activityClient: createPipelineActivityClient({ graphClient }),
    itemLock: createItemLock(),
    mailer,
    michaelEmail: MICHAEL_EMAIL,
  });
}
```

3e. Extend `createApp`'s signature and add the route (before `return app;`). The signature becomes:

```js
function createApp({
  pipelineSync = buildDefaultPipelineSync(),
  mailer = buildDefaultMailer(),
  leadAckEnabled = LEAD_ACK_ENABLED,
  bookingUrl = BOOKING_URL,
  stageEngine = null,
  graphClientState = GRAPH_CLIENT_STATE,
} = {}) {
  const app = express();
  const engine = stageEngine || buildDefaultStageEngine(mailer);
```

(References to `stageEngine` below use `engine`.) The route:

```js
// -------------------------------------------------------------------------
// POST /webhooks/graph-pipeline
// Graph change notifications for the Client Pipeline list (Flow E).
// Notifications carry no item data — the stage engine delta-queries the
// list to find what changed.
// -------------------------------------------------------------------------
app.post("/webhooks/graph-pipeline", (req, res) => {
  try {
    // Subscription-creation validation handshake: echo the token as
    // text/plain within 10 seconds, before touching any Graph state —
    // it fires before a subscription exists to look anything up against.
    if (req.query.validationToken) {
      return res.status(200).type("text/plain").send(req.query.validationToken);
    }

    const notifications = req.body?.value || [];
    if (!validateGraphClientState(notifications, graphClientState)) {
      console.warn("[graph-pipeline] clientState rejected");
      return res.status(401).json({ error: "Invalid clientState" });
    }

    // Graph enforces a fast-ack SLA on notification endpoints — respond
    // now, process in the background (same pattern as the other hooks).
    res.status(202).send();

    (async () => {
      const outcomes = await engine.processNotifications();
      const acted = outcomes.filter(
        (o) => o.action !== "skip" && o.action !== "unhandled",
      );
      console.log(
        `[graph-pipeline] delta: ${outcomes.length} changed item(s), ${acted.length} acted on`,
      );
    })().catch((err) => {
      console.error("[graph-pipeline] Background processing failed:", err);
    });
  } catch (err) {
    console.error("[graph-pipeline] Handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});
```

3f. Startup wiring — inside the existing `if (require.main === module)` block, after `app.listen(...)`:

```js
// Flow E subscription bootstrap: ensure immediately on boot (an interval
// alone can miss a lapse across Railway restarts), then re-check every
// 12 hours — renewals trigger when a subscription is within 48h of
// expiry, far inside the ~30-day window.
if (GRAPH_NOTIFICATION_URL && GRAPH_CLIENT_STATE) {
  const subscriptions = createSubscriptionsClient();
  const ensure = () =>
    subscriptions
      .ensureSubscription()
      .then((r) => console.log(`[subscriptions] ${JSON.stringify(r)}`))
      .catch((err) =>
        console.error("[subscriptions] ensure failed:", err.message),
      );
  ensure();
  setInterval(ensure, 12 * 60 * 60 * 1000).unref();
} else {
  console.log(
    "[server] Graph pipeline notifications disabled (set GRAPH_NOTIFICATION_URL and GRAPH_SUBSCRIPTION_CLIENT_STATE)",
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `webhook-server/`): `npm test`
Expected: PASS — all existing tests plus the 6 new ones. (Existing tests must keep passing: `withServer` doesn't pass `stageEngine`, so `createApp` must not build the default engine eagerly at module load — the `stageEngine || buildDefaultStageEngine(mailer)` call happens per-createApp with the injected fake mailer, which never sends real mail; `createGraphClient()` construction reads env vars but performs no network I/O until called, so constructing it in tests is safe.)

- [ ] **Step 5: Update `webhook-server/README.md`**

Add under the Endpoints section:

```markdown
- `POST /webhooks/graph-pipeline` — Microsoft Graph change notifications
  for the SharePoint Client Pipeline list (Flow E stage engine). Handles
  the subscription validation handshake (`?validationToken=...`) and
  rejects any notification whose `clientState` doesn't match
  `GRAPH_SUBSCRIPTION_CLIENT_STATE`.
```

Add to the environment-variables section:

```markdown
# Flow E — stage engine (Graph change notifications)

GRAPH_NOTIFICATION_URL=https://<your-railway-url>/webhooks/graph-pipeline
GRAPH_SUBSCRIPTION_CLIENT_STATE=<long random string — rotate like CALENDLY_WEBHOOK_SIGNING_KEY>
SHAREPOINT_ACTIVITY_LIST_ID=<list id of the Pipeline Activity list>
```

Add a deploy-checklist subsection near the SharePoint setup section:

```markdown
### Flow E deploy checklist

1. Confirm the `Pipeline Activity` list's internal column names match
   `lib/pipeline-activity.js` `FIELDS` (`EventKey`, `EventType`,
   `EventSource`, `EventTimestamp`, `ActorOrFlow`, `Summary`, `Outcome`,
   `ErrorDetails`, `PipelineItemID`):
   `GET https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{activity-list-id}/columns`
   — fix `FIELDS` (one place) if any differ, and add any missing columns
   (e.g. `PipelineItemID` as a single-line-of-text column) to the list.
2. Set the three env vars above in Railway and redeploy.
3. Watch the boot log for `[subscriptions] {"action":"created",...}` —
   the validation handshake fails (and subscription creation errors) if
   the deployed URL isn't reachable over HTTPS.
4. Test end-to-end: move a test item's `Stage` to `Consult Held` in the
   SharePoint UI; expect exactly one reminder email, one `Pipeline
Activity` Success row, and `PreviousStage`/`StageChangedAt` set on the
   item — and no repeat when the item is touched again.
```

- [ ] **Step 6: Run the whole suite, then commit**

Run (from `webhook-server/`): `npm test` — expected: all pass.

```bash
git add webhook-server/server.js webhook-server/server.test.js webhook-server/README.md
git commit -m "feat(webhook-server): graph-pipeline webhook endpoint and subscription bootstrap"
```

---

### Task 7: Run webhook-server tests in CI — `.github/workflows/ci.yml`

**Files:**

- Modify: `.github/workflows/ci.yml` (add a second job)

**Interfaces:**

- Consumes: `webhook-server/package-lock.json` (exists), `npm test` script (exists — `node --test lib/*.test.js server.test.js`). Tests require no env vars or network (all Graph deps are faked).
- Produces: a `webhook-server` job that fails the PR check when any webhook-server test fails.

- [ ] **Step 1: Add the job** (aligned with the existing job's pinned action SHAs):

```yaml
webhook-server:
  runs-on: ubuntu-latest
  defaults:
    run:
      working-directory: webhook-server
  steps:
    - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      with:
        persist-credentials: false

    - name: Set up Node.js
      uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
      with:
        node-version: 20
        cache: "npm"
        cache-dependency-path: webhook-server/package-lock.json

    - name: Install dependencies
      run: npm ci

    - name: Run webhook-server tests
      run: npm test
```

- [ ] **Step 2: Validate the workflow locally**

Run (from repo root): `npx --yes yaml-lint .github/workflows/ci.yml` — or, if that tool isn't available, `node -e "require('node:fs').readFileSync('.github/workflows/ci.yml','utf8')" && npx --yes js-yaml .github/workflows/ci.yml >/dev/null && echo OK`
Expected: no parse errors. Also verify locally that `npm ci && npm test` succeeds inside `webhook-server/`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run webhook-server node:test suite on pull requests"
```

---

## Deployment checklist (manual, after merge — not code tasks)

Tracked in Task 6's README addition; summarized here for the human:

1. Verify/fix `Pipeline Activity` internal column names against the live list; add `PipelineItemID` (text) if absent.
2. Generate a long random `GRAPH_SUBSCRIPTION_CLIENT_STATE`; set it, `GRAPH_NOTIFICATION_URL`, and `SHAREPOINT_ACTIVITY_LIST_ID` in Railway.
3. Redeploy; confirm `[subscriptions] {"action":"created"...}` in logs.
4. End-to-end test per the README checklist (one Stage edit → one email, one activity row, no self-retrigger).
5. Optional schema follow-up from spec §6 (adding `TimelineVersion`, `RecalculateTimeline`, etc.) is Phase 2 prep, not required for Phase 1 — code tolerates their absence.

## Self-review notes

- Spec §8 Phase 1 coverage: subscription infra (Task 3 + 6), validation handshake (Task 6), renewal check (Tasks 3 + 6), Pipeline Activity client + EventKey skeleton (Task 2 + 5), per-item lock (Task 1), fast-ack handler (Task 6), Consult Held with questionnaire stub (Task 5), CI wiring (Task 7). Delta query (spec §1.3) is Task 4.
- Spec §9 test list → covered: double-event (Task 5), two rapid edits (Task 1), self-update (Task 5), partial failure (Task 5), validation handshake (Task 6), clientState rejection (Task 6). Recalculation/nudge tests are Phase 2+.
- Type consistency: `fetchListDelta` returns `{ reset, items, deltaLink }` (Tasks 4, 5); `recordActivity`/`findSuccessByEventKey` signatures match between Tasks 2 and 5; `withItemLock(itemId, fn)` matches between Tasks 1 and 5; `createApp` option names match between Task 6 code and tests.
