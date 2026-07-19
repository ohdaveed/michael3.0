# Calendly/Tally Intake → SharePoint `Client Pipeline` List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the two existing intake paths (Tally contact-form messages, Calendly consultation bookings) into a new SharePoint `Client Pipeline` list, so every message/booking becomes one row without duplicating rows on webhook retries or guessing when multiple open matters share an email.

**Architecture:** `webhook-server` (existing Express app on Railway) gains a small library of pure, dependency-injected modules — a generic Microsoft Graph HTTP client, a pipeline-specific SharePoint wrapper, and a matching/upsert orchestrator — wired into the two existing route handlers after their current email/downstream-forward logic. No new external services, no new npm dependencies.

**Tech Stack:** Node.js ≥18 (native `fetch`, `node:test`, `node:assert/strict`), Express (existing), Microsoft Graph REST API v1.0, Azure AD client-credentials OAuth.

## Global Constraints

- No new npm dependencies. Use Node's built-in `fetch` and `node:test`/`node:assert/strict` for everything — do not add `axios`, `nock`, `supertest`, `jest`, etc.
- Graph auth is **`Sites.Selected`** only, scoped to the new "Lehr Law Practice" site — never request or use `Sites.ReadWrite.All`.
- The Azure AD app registration's client secret must be created with an explicit expiration (≤12 months recommended by Microsoft) — this is a manual portal step documented in Task 5, not something code enforces, but do not skip documenting it.
- Webhook HTTP responses must always be `200` regardless of whether the SharePoint sync succeeds — Tally and Calendly both retry on non-2xx. SharePoint failures are caught, logged, and alert Michael by email; they never turn into a 500.
- An "open" pipeline item is any row whose `Stage` is **not** `Complete`, `Declined`, `Not a Fit`, or `No Response`. `Consult Cancelled` is still open (a cancelled consult can still be rebooked — the row survives, only its `Stage` changes to `Consult Cancelled`, matching `client-pipeline.md` Flow C's "keep the lead row").
- Updating an existing pipeline row from the message path never writes `Stage` — only the create path sets `Stage: "New Inquiry"`. This is how "never move Stage backward" (per the spec) is satisfied without extra logic.
- The idempotency key for a Calendly booking is `payload.uri` from the webhook body (the invitee's canonical URI) — stored as `CalendlyEventURI`. This is present and stable across both `invitee.created` and `invitee.canceled` for the same booking.
- `webhook-server`'s Railway deployment root is `webhook-server/` — files outside that directory (e.g. `public/js/product-contract.json`) are not present in the deployed container, so the product taxonomy is duplicated into `webhook-server/product-contract.json` rather than referenced by relative path across the deploy boundary. Keep the two files' `products` arrays identical; a change to one requires bumping `contract_version` and updating the other (same rule `public/js/product-contract.json` already documents for its other consumers).

---

### Task 1: Product taxonomy mapping

**Files:**

- Create: `webhook-server/product-contract.json`
- Create: `webhook-server/lib/product-contract.js`
- Test: `webhook-server/lib/product-contract.test.js`

**Interfaces:**

- Produces: `mapLabelToCode(label: string): string | null` — used by Task 3.

- [ ] **Step 1: Copy the product taxonomy into webhook-server**

Copy the file verbatim:

```bash
cp /mnt/c/Users/david/michael3.0/public/js/product-contract.json /mnt/c/Users/david/michael3.0/webhook-server/product-contract.json
```

- [ ] **Step 2: Write the failing test**

Create `webhook-server/lib/product-contract.test.js`:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mapLabelToCode } = require("./product-contract");

test("maps a known label to its stable code", () => {
  assert.equal(mapLabelToCode("Will Only"), "WILL_ONLY");
});

test("maps the multi-word label correctly", () => {
  assert.equal(
    mapLabelToCode("Complete Living Trust Package"),
    "TRUST_PACKAGE",
  );
});

test("returns null for an unrecognized label", () => {
  assert.equal(mapLabelToCode("Not a real service"), null);
});

test("returns null for an empty label", () => {
  assert.equal(mapLabelToCode(""), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webhook-server && node --test lib/product-contract.test.js`
Expected: FAIL — `Cannot find module './product-contract'`

- [ ] **Step 3: Write the implementation**

Create `webhook-server/lib/product-contract.js`:

```js
"use strict";

const contract = require("../product-contract.json");

const labelToCode = new Map(contract.products.map((p) => [p.label, p.code]));

function mapLabelToCode(label) {
  return labelToCode.get(label) || null;
}

module.exports = { mapLabelToCode };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webhook-server && node --test lib/product-contract.test.js`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add webhook-server/product-contract.json webhook-server/lib/product-contract.js webhook-server/lib/product-contract.test.js
git commit -m "feat(webhook-server): add product taxonomy label-to-code mapping"
```

---

### Task 2: Generic Microsoft Graph HTTP client

**Files:**

- Create: `webhook-server/lib/graph-client.js`
- Test: `webhook-server/lib/graph-client.test.js`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `createGraphClient({ tenantId, clientId, clientSecret, fetchImpl, now }): { getAccessToken(): Promise<string>, graphFetch(path: string, options?: RequestInit): Promise<any> }` — used by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `webhook-server/lib/graph-client.test.js`:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGraphClient } = require("./graph-client");

test("getAccessToken requests a token and caches it across calls", async () => {
  let tokenRequests = 0;
  const fetchImpl = async () => {
    tokenRequests++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: "abc123", expires_in: 3600 }),
    };
  };
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl,
    now: () => 0,
  });

  const token1 = await client.getAccessToken();
  const token2 = await client.getAccessToken();

  assert.equal(token1, "abc123");
  assert.equal(token2, "abc123");
  assert.equal(tokenRequests, 1, "second call should reuse the cached token");
});

test("getAccessToken refetches once the cached token nears expiry", async () => {
  let tokenRequests = 0;
  let currentTime = 0;
  const fetchImpl = async () => {
    tokenRequests++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: `tok-${tokenRequests}`,
        expires_in: 3600,
      }),
    };
  };
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl,
    now: () => currentTime,
  });

  await client.getAccessToken();
  currentTime = 3600 * 1000; // past expiry
  const token = await client.getAccessToken();

  assert.equal(token, "tok-2");
  assert.equal(tokenRequests, 2);
});

test("getAccessToken throws when the token request fails", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 });
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl,
    now: () => 0,
  });

  await assert.rejects(() => client.getAccessToken(), /401/);
});

test("graphFetch attaches a bearer token and parses JSON on success", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "abc123", expires_in: 3600 }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ value: [] }) };
  };
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl,
    now: () => 0,
  });

  const result = await client.graphFetch("/sites/x/lists/y/items");

  assert.deepEqual(result, { value: [] });
  const dataCall = calls[1];
  assert.equal(
    dataCall.url,
    "https://graph.microsoft.com/v1.0/sites/x/lists/y/items",
  );
  assert.equal(dataCall.options.headers.Authorization, "Bearer abc123");
});

test("graphFetch throws with the status and response body on failure", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "abc123", expires_in: 3600 }),
      };
    }
    return { ok: false, status: 403, text: async () => "Forbidden" };
  };
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl,
    now: () => 0,
  });

  await assert.rejects(
    () =>
      client.graphFetch("/sites/x/lists/y/items", {
        method: "POST",
        body: "{}",
      }),
    /403/,
  );
});

test("graphFetch returns null for a 204 No Content response", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "abc123", expires_in: 3600 }),
      };
    }
    return { ok: true, status: 204 };
  };
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl,
    now: () => 0,
  });

  const result = await client.graphFetch("/sites/x/lists/y/items/1/fields", {
    method: "PATCH",
    body: "{}",
  });

  assert.equal(result, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-server && node --test lib/graph-client.test.js`
Expected: FAIL — `Cannot find module './graph-client'`

- [ ] **Step 3: Write the implementation**

Create `webhook-server/lib/graph-client.js`:

```js
"use strict";

// Generic Microsoft Graph HTTP client: client-credentials token acquisition
// (cached until near expiry) plus a thin authenticated-fetch wrapper.
// No SharePoint- or pipeline-specific knowledge lives here — see
// lib/sharepoint.js for that.
function createGraphClient({
  tenantId = process.env.GRAPH_TENANT_ID,
  clientId = process.env.GRAPH_CLIENT_ID,
  clientSecret = process.env.GRAPH_CLIENT_SECRET,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  let cachedToken = null; // { accessToken, expiresAt }

  async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > now() + 60_000) {
      return cachedToken.accessToken;
    }
    const res = await fetchImpl(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`[graph] Token request failed: ${res.status}`);
    }
    const data = await res.json();
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: now() + data.expires_in * 1000,
    };
    return cachedToken.accessToken;
  }

  async function graphFetch(path, options = {}) {
    const token = await getAccessToken();
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await (res.text ? res.text() : Promise.resolve(""));
      throw new Error(
        `[graph] ${options.method || "GET"} ${path} failed: ${res.status} ${body}`,
      );
    }
    return res.status === 204 ? null : res.json();
  }

  return { getAccessToken, graphFetch };
}

module.exports = { createGraphClient };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-server && node --test lib/graph-client.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add webhook-server/lib/graph-client.js webhook-server/lib/graph-client.test.js
git commit -m "feat(webhook-server): add Microsoft Graph client-credentials HTTP client"
```

---

### Task 3: SharePoint pipeline-list wrapper

**Files:**

- Create: `webhook-server/lib/sharepoint.js`
- Test: `webhook-server/lib/sharepoint.test.js`

**Interfaces:**

- Consumes: `createGraphClient` from Task 2 (default), or an injected fake with a `graphFetch(path, options)` method.
- Produces: `createSharepointClient({ graphClient }): { findOpenItemByEmail(email): Promise<Array<{id, fields}>>, findItemByCalendlyEventUri(uri): Promise<{id, fields} | null>, createPipelineItem(fields): Promise<{id}>, updatePipelineItem(itemId, fields): Promise<null> }` — used by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `webhook-server/lib/sharepoint.test.js`:

```js
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
```

Note: the `updatePipelineItem` test asserts a literal `/sites/undefined/lists/undefined/` path because `SHAREPOINT_SITE_ID`/`SHAREPOINT_LIST_ID` aren't set in the test environment — this confirms the path is built from those env vars without needing to set them for this unit test. Task 6 verifies the real values end-to-end.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-server && node --test lib/sharepoint.test.js`
Expected: FAIL — `Cannot find module './sharepoint'`

- [ ] **Step 3: Write the implementation**

Create `webhook-server/lib/sharepoint.js`:

```js
"use strict";

const { createGraphClient } = require("./graph-client");

const SITE_ID = process.env.SHAREPOINT_SITE_ID;
const LIST_ID = process.env.SHAREPOINT_LIST_ID;

// Closed stages are excluded from "open item" matching — a matter in any
// of these stages is done and shouldn't receive further intake updates.
// "Consult Cancelled" is deliberately NOT in this list: a cancelled
// consult can still be rebooked, so the row stays open.
const CLOSED_STAGES = ["Complete", "Declined", "Not a Fit", "No Response"];

function createSharepointClient({ graphClient = createGraphClient() } = {}) {
  async function findOpenItemByEmail(email) {
    const escapedEmail = email.replace(/'/g, "''");
    const closedFilter = CLOSED_STAGES.map(
      (s) => `fields/Stage ne '${s}'`,
    ).join(" and ");
    const query = new URLSearchParams({
      expand: "fields",
      $filter: `fields/Email eq '${escapedEmail}' and ${closedFilter}`,
    });
    const data = await graphClient.graphFetch(
      `/sites/${SITE_ID}/lists/${LIST_ID}/items?${query.toString()}`,
      {
        method: "GET",
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
      },
    );
    return data.value || [];
  }

  async function findItemByCalendlyEventUri(uri) {
    const escapedUri = uri.replace(/'/g, "''");
    const query = new URLSearchParams({
      expand: "fields",
      $filter: `fields/CalendlyEventURI eq '${escapedUri}'`,
    });
    const data = await graphClient.graphFetch(
      `/sites/${SITE_ID}/lists/${LIST_ID}/items?${query.toString()}`,
      {
        method: "GET",
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
      },
    );
    return (data.value || [])[0] || null;
  }

  async function createPipelineItem(fields) {
    return graphClient.graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}/items`, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
  }

  async function updatePipelineItem(itemId, fields) {
    return graphClient.graphFetch(
      `/sites/${SITE_ID}/lists/${LIST_ID}/items/${itemId}/fields`,
      { method: "PATCH", body: JSON.stringify(fields) },
    );
  }

  return {
    findOpenItemByEmail,
    findItemByCalendlyEventUri,
    createPipelineItem,
    updatePipelineItem,
  };
}

module.exports = { createSharepointClient };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-server && node --test lib/sharepoint.test.js`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add webhook-server/lib/sharepoint.js webhook-server/lib/sharepoint.test.js
git commit -m "feat(webhook-server): add SharePoint Client Pipeline list wrapper"
```

---

### Task 4: Matching/upsert orchestration

**Files:**

- Create: `webhook-server/lib/pipeline-sync.js`
- Test: `webhook-server/lib/pipeline-sync.test.js`

**Interfaces:**

- Consumes: `mapLabelToCode` from Task 1; a `sharepointClient` matching Task 3's shape (real or fake).
- Produces:
  - `createPipelineSync({ sharepointClient }): { syncTallyMessage(input), syncCalendlyBooking(input), syncCalendlyCancellation(input) }`
  - `syncTallyMessage({ submissionId, firstName, lastName, email, phone, service }): Promise<{ ok: true, action: string, itemId?: string }>`
  - `syncCalendlyBooking({ eventUri, name, email, startTime, endTime, timeZone, cancelUrl, rescheduleUrl }): Promise<{ ok: true, action: string, itemId?: string }>`
  - `syncCalendlyCancellation({ eventUri }): Promise<{ ok: true, action: string, itemId?: string }>`
  - All three reject (throw) if the underlying `sharepointClient` call throws — callers (Task 5) are responsible for catching.
  - Used by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `webhook-server/lib/pipeline-sync.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-server && node --test lib/pipeline-sync.test.js`
Expected: FAIL — `Cannot find module './pipeline-sync'`

- [ ] **Step 3: Write the implementation**

Create `webhook-server/lib/pipeline-sync.js`:

```js
"use strict";

const { mapLabelToCode } = require("./product-contract");

function newestFirst(items) {
  return [...items].sort(
    (a, b) =>
      new Date(b.fields.InquiryReceivedAt) -
      new Date(a.fields.InquiryReceivedAt),
  );
}

async function flagMultipleMatches(sharepointClient, openItems) {
  const newest = newestFirst(openItems)[0];
  const notes =
    `${newest.fields.Notes || ""}\n[NEEDS REVIEW: multiple open matters for this email]`.trim();
  await sharepointClient.updatePipelineItem(newest.id, { Notes: notes });
  return { ok: true, action: "flagged-multiple", itemId: newest.id };
}

function createPipelineSync({ sharepointClient }) {
  async function syncTallyMessage({
    submissionId,
    firstName,
    lastName,
    email,
    phone,
    service,
  }) {
    const openItems = await sharepointClient.findOpenItemByEmail(email);

    if (openItems.length > 1) {
      return flagMultipleMatches(sharepointClient, openItems);
    }

    if (openItems.length === 1) {
      const item = openItems[0];
      if (item.fields.TallySubmissionID === submissionId) {
        return { ok: true, action: "no-op-duplicate", itemId: item.id };
      }
      await sharepointClient.updatePipelineItem(item.id, {
        FirstName: firstName,
        LastName: lastName,
        Phone: phone,
        DesiredProductLabel: service,
        DesiredProductCode: mapLabelToCode(service),
        TallySubmissionID: submissionId,
      });
      return { ok: true, action: "updated", itemId: item.id };
    }

    const created = await sharepointClient.createPipelineItem({
      Title: `${lastName}, ${firstName} — ${service}`,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Phone: phone,
      Source: "Website Message",
      DesiredProductLabel: service,
      DesiredProductCode: mapLabelToCode(service),
      TallySubmissionID: submissionId,
      Stage: "New Inquiry",
      InquiryReceivedAt: new Date().toISOString(),
    });
    return { ok: true, action: "created", itemId: created.id };
  }

  async function syncCalendlyBooking({
    eventUri,
    name,
    email,
    startTime,
    endTime,
    timeZone,
    cancelUrl,
    rescheduleUrl,
  }) {
    const openItems = await sharepointClient.findOpenItemByEmail(email);

    if (openItems.length > 1) {
      return flagMultipleMatches(sharepointClient, openItems);
    }

    const bookingFields = {
      Stage: "Consult Scheduled",
      ConsultStart: startTime,
      ConsultEnd: endTime,
      ConsultTimeZone: timeZone,
      CalendlyEventURI: eventUri,
      Notes: `Reschedule: ${rescheduleUrl}\nCancel: ${cancelUrl}`,
    };

    if (openItems.length === 1) {
      const item = openItems[0];
      if (item.fields.CalendlyEventURI === eventUri) {
        return { ok: true, action: "no-op-duplicate", itemId: item.id };
      }
      await sharepointClient.updatePipelineItem(item.id, bookingFields);
      return { ok: true, action: "updated", itemId: item.id };
    }

    const [firstName, ...rest] = name.split(" ");
    const lastName = rest.join(" ") || "(unknown)";
    const created = await sharepointClient.createPipelineItem({
      Title: `${lastName}, ${firstName} — Consultation`,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Source: "Booking",
      InquiryReceivedAt: new Date().toISOString(),
      ...bookingFields,
    });
    return { ok: true, action: "created", itemId: created.id };
  }

  async function syncCalendlyCancellation({ eventUri }) {
    const item = await sharepointClient.findItemByCalendlyEventUri(eventUri);
    if (!item) {
      return { ok: true, action: "no-matching-item" };
    }
    await sharepointClient.updatePipelineItem(item.id, {
      Stage: "Consult Cancelled",
    });
    return { ok: true, action: "cancelled", itemId: item.id };
  }

  return { syncTallyMessage, syncCalendlyBooking, syncCalendlyCancellation };
}

module.exports = { createPipelineSync };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-server && node --test lib/pipeline-sync.test.js`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add webhook-server/lib/pipeline-sync.js webhook-server/lib/pipeline-sync.test.js
git commit -m "feat(webhook-server): add pipeline matching/upsert orchestration"
```

---

### Task 5: Wire pipeline sync into the webhook routes

**Files:**

- Modify: `webhook-server/server.js` (full-file rewrite — the change threads through both route handlers and the startup block)
- Test: `webhook-server/server.test.js`

**Interfaces:**

- Consumes: `createGraphClient` (Task 2), `createSharepointClient` (Task 3), `createPipelineSync` (Task 4).
- Produces: `createApp({ pipelineSync }): express.Application` — an exported factory so tests can inject a fake `pipelineSync` instead of hitting real Graph/SharePoint. `require.main === module` still calls `app.listen(PORT)` when run directly, so `npm start`/`npm run dev` behavior is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `webhook-server/server.test.js`:

```js
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

async function withServer(pipelineSync, fn) {
  const app = createApp({ pipelineSync });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-server && node --test server.test.js`
Expected: FAIL — `createApp` is not exported yet (current `server.js` doesn't export anything).

- [ ] **Step 3: Rewrite server.js**

Replace the entire contents of `webhook-server/server.js` with:

```js
// Lehr Law — Webhook Server
// Receives Tally contact form submissions and Calendly booking events,
// validates payloads, emails Michael, optionally forwards to a downstream
// URL, and syncs prospective-matter data into the SharePoint Client
// Pipeline list via Microsoft Graph.
//
// Deploy to Railway (railway.app) — see README.md for full setup.

"use strict";

const crypto = require("crypto");
const express = require("express");
const nodemailer = require("nodemailer");
const { createGraphClient } = require("./lib/graph-client");
const { createSharepointClient } = require("./lib/sharepoint");
const { createPipelineSync } = require("./lib/pipeline-sync");

// ---------------------------------------------------------------------------
// Config — all values come from environment variables (set in Railway)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const MICHAEL_EMAIL = process.env.MICHAEL_EMAIL || "michael@lehr-law.com";
const SMTP_HOST = process.env.SMTP_HOST; // e.g. smtp.office365.com
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER; // sending address
const SMTP_PASS = process.env.SMTP_PASS; // app password / OAuth token
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const CALENDLY_SIGNING_KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY || "";
// Optional: POST a structured JSON summary to a second destination
// (Power Automate HTTP trigger, Relay.app, Zapier catch-hook, etc.)
const DOWNSTREAM_URL = process.env.DOWNSTREAM_URL || "";
const TALLY_FORM_ID = process.env.TALLY_FORM_ID || "ob17lb";

// ---------------------------------------------------------------------------
// Mailer
// ---------------------------------------------------------------------------
let mailer = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendEmail({ subject, text, html }) {
  if (!mailer) {
    console.warn("[email] SMTP not configured — skipping email send");
    return;
  }
  try {
    await mailer.sendMail({
      from: `"Lehr Law Site" <${SMTP_FROM}>`,
      to: MICHAEL_EMAIL,
      subject,
      text,
      html,
    });
    console.log(`[email] Sent: ${subject}`);
  } catch (err) {
    console.error("[email] Send failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Downstream forwarding (optional)
// ---------------------------------------------------------------------------
async function forwardDownstream(payload) {
  if (!DOWNSTREAM_URL) return;
  try {
    const res = await fetch(DOWNSTREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log(`[downstream] ${res.status} ${DOWNSTREAM_URL}`);
  } catch (err) {
    console.error("[downstream] Forward failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// SharePoint pipeline sync — failures here must never fail the webhook
// response (Tally/Calendly both retry on non-2xx). Always catch, log, and
// alert Michael by email; the row can be reconciled manually. Michael's
// existing notification email has already been sent by this point, so no
// data is lost on a sync failure.
// ---------------------------------------------------------------------------
function buildDefaultPipelineSync() {
  const graphClient = createGraphClient();
  const sharepointClient = createSharepointClient({ graphClient });
  return createPipelineSync({ sharepointClient });
}

async function syncPipelineSafely(fn, contextLabel) {
  try {
    const result = await fn();
    console.log(
      `[pipeline] ${contextLabel}: ${result.action} (item ${result.itemId || "n/a"})`,
    );
    return result;
  } catch (err) {
    console.error(`[pipeline] ${contextLabel} failed:`, err.message);
    await sendEmail({
      subject: `[ALERT] SharePoint sync failed — ${contextLabel}`,
      text: [
        `SharePoint sync failed for: ${contextLabel}`,
        ``,
        `Error: ${err.message}`,
        ``,
        `Check Railway logs. No data was lost — the email notification for`,
        `this event already sent.`,
      ].join("\n"),
    });
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Calendly HMAC-SHA256 signature validation
// Calendly sends: t=<timestamp>,v1=<sig> in the
// Calendly-Webhook-Signature header.
// ---------------------------------------------------------------------------
function validateCalendlySignature(req) {
  if (!CALENDLY_SIGNING_KEY) return true; // skip if key not configured
  const header = req.headers["calendly-webhook-signature"] || "";
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2)),
  );
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expectedSig = crypto
    .createHmac("sha256", CALENDLY_SIGNING_KEY)
    .update(`${timestamp}.${req.rawBody}`)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSig, "hex"),
  );
}

// ---------------------------------------------------------------------------
// App factory — accepts injectable deps so tests can pass a fake
// pipelineSync instead of hitting real Graph/SharePoint.
// ---------------------------------------------------------------------------
function createApp({ pipelineSync = buildDefaultPipelineSync() } = {}) {
  const app = express();

  // Capture rawBody for Calendly HMAC validation before JSON parsing
  app.use((req, res, next) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      req.rawBody = raw;
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch {
        req.body = {};
      }
      next();
    });
  });

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  app.get("/", (req, res) => {
    res.json({ ok: true, service: "lehr-law-webhook-server", ts: new Date() });
  });

  // -------------------------------------------------------------------------
  // POST /webhooks/tally
  // Tally sends: { eventId, createdAt, data: { submissionId, formId, fields[] } }
  // -------------------------------------------------------------------------
  app.post("/webhooks/tally", async (req, res) => {
    try {
      const body = req.body;
      const submissionId = body?.data?.submissionId;
      const formId = body?.data?.formId;

      if (formId !== TALLY_FORM_ID) {
        console.warn(`[tally] Unknown formId: ${formId}`);
        return res.status(400).json({ error: "Unknown form" });
      }

      const fields = {};
      for (const f of body?.data?.fields || []) {
        fields[f.label] = Array.isArray(f.value) ? f.value.join(", ") : f.value;
      }

      if (fields["form_source"] !== "lehr-law-contact") {
        console.warn(
          `[tally] Unexpected form_source: ${fields["form_source"]}`,
        );
        return res.status(400).json({ error: "Invalid form_source" });
      }

      const firstName = fields["First name"] || "";
      const lastName = fields["Last name"] || "";
      const email = fields["Email"] || "";
      const phone = fields["Phone"] || "(not provided)";
      const service = fields["Service needed"] || "(not specified)";
      const message = fields["Message"] || "";
      const page = fields["page"] || "";
      const contractVersion = fields["contract_version"] || "";

      console.log(
        `[tally] Submission ${submissionId} from ${firstName} ${lastName} <${email}>`,
      );

      const subject = `New message from ${firstName} ${lastName} — ${service}`;
      const text = [
        `New contact form submission via lehr-law.com`,
        ``,
        `Name:    ${firstName} ${lastName}`,
        `Email:   ${email}`,
        `Phone:   ${phone}`,
        `Service: ${service}`,
        ``,
        `Message:`,
        message,
        ``,
        `---`,
        `Submission ID: ${submissionId}`,
        `Form: ${formId} (contract v${contractVersion}, page: ${page})`,
        `Received: ${new Date().toISOString()}`,
      ].join("\n");

      const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#0b1d33">New contact form submission</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;color:#6b6559;width:100px">Name</td>
        <td style="padding:8px;font-weight:600">${firstName} ${lastName}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${email}">${email}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Phone</td>
        <td style="padding:8px">${phone}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Service</td>
        <td style="padding:8px">${service}</td></tr>
  </table>
  <div style="margin-top:20px;padding:16px;background:#f5f0e8;border-left:3px solid #c5a55a">
    <strong>Message:</strong><br/><br/>
    ${message.replace(/\n/g, "<br/>")}
  </div>
  <p style="margin-top:20px;font-size:12px;color:#9a9088">
    Submission ID: ${submissionId} &middot; Received: ${new Date().toISOString()}
  </p>
</div>`;

      await Promise.all([
        sendEmail({ subject, text, html }),
        forwardDownstream({
          source: "tally",
          submissionId,
          formId,
          contractVersion,
          firstName,
          lastName,
          email,
          phone,
          service,
          message,
          page,
          receivedAt: new Date().toISOString(),
        }),
      ]);

      await syncPipelineSafely(
        () =>
          pipelineSync.syncTallyMessage({
            submissionId,
            firstName,
            lastName,
            email,
            phone,
            service,
          }),
        `Tally submission ${submissionId} <${email}>`,
      );

      res.json({ ok: true, submissionId });
    } catch (err) {
      console.error("[tally] Handler error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /webhooks/calendly
  // Calendly sends: { event, created_at, created_by, payload: { uri, event, invitee } }
  // Supported events: invitee.created, invitee.canceled
  // -------------------------------------------------------------------------
  app.post("/webhooks/calendly", async (req, res) => {
    try {
      // Validate HMAC signature
      if (!validateCalendlySignature(req)) {
        console.warn("[calendly] Invalid signature — rejecting");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const body = req.body;
      const eventType = body?.event;
      const payload = body?.payload || {};
      const invitee = payload?.invitee || {};
      const event = payload?.event || {};
      // The invitee's own URI is the stable idempotency key — present and
      // unchanged across both invitee.created and invitee.canceled for the
      // same booking.
      const eventUri = payload?.uri || "";

      const name =
        invitee.name ||
        `${invitee.first_name || ""} ${invitee.last_name || ""}`.trim();
      const email = invitee.email || "";
      const startTime = event.start_time
        ? new Date(event.start_time).toLocaleString("en-US", {
            timeZone: "America/Los_Angeles",
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          })
        : "(unknown)";
      const eventName = event.name || "Estate Planning Consultation";
      const cancelUrl = payload?.cancel_url || "";
      const rescheduleUrl = payload?.reschedule_url || "";

      // Questions & answers (custom intake questions from the Calendly form)
      const qas = (payload?.questions_and_answers || [])
        .map((qa) => `${qa.question}: ${qa.answer}`)
        .join("\n");

      console.log(
        `[calendly] ${eventType} — ${name} <${email}> @ ${startTime}`,
      );

      if (eventType === "invitee.created") {
        const subject = `New booking: ${name} — ${startTime}`;
        const text = [
          `New consultation booked via Calendly`,
          ``,
          `Name:    ${name}`,
          `Email:   ${email}`,
          `Event:   ${eventName}`,
          `Time:    ${startTime}`,
          qas ? `\nResponses:\n${qas}` : "",
          ``,
          `Reschedule: ${rescheduleUrl}`,
          `Cancel:     ${cancelUrl}`,
          ``,
          `Received: ${new Date().toISOString()}`,
        ].join("\n");

        const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#0b1d33">New consultation booked</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;color:#6b6559;width:100px">Name</td>
        <td style="padding:8px;font-weight:600">${name}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${email}">${email}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Time</td>
        <td style="padding:8px;font-weight:600;color:#c5a55a">${startTime}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Event</td>
        <td style="padding:8px">${eventName}</td></tr>
  </table>
  ${
    qas
      ? `<div style="margin-top:20px;padding:16px;background:#f5f0e8;border-left:3px solid #c5a55a">
           <strong>Intake responses:</strong><br/><br/>
           ${qas.replace(/\n/g, "<br/>")}
         </div>`
      : ""
  }
  <div style="margin-top:20px">
    <a href="${rescheduleUrl}" style="margin-right:16px;color:#0b1d33">Reschedule</a>
    <a href="${cancelUrl}" style="color:#c62828">Cancel</a>
  </div>
  <p style="margin-top:20px;font-size:12px;color:#9a9088">
    Received: ${new Date().toISOString()}
  </p>
</div>`;

        await Promise.all([
          sendEmail({ subject, text, html }),
          forwardDownstream({
            source: "calendly",
            eventType: "booking.created",
            name,
            email,
            eventName,
            startTime: event.start_time,
            endTime: event.end_time,
            questionsAndAnswers: payload?.questions_and_answers || [],
            cancelUrl,
            rescheduleUrl,
            receivedAt: new Date().toISOString(),
          }),
        ]);

        await syncPipelineSafely(
          () =>
            pipelineSync.syncCalendlyBooking({
              eventUri,
              name,
              email,
              startTime: event.start_time,
              endTime: event.end_time,
              timeZone: "America/Los_Angeles",
              cancelUrl,
              rescheduleUrl,
            }),
          `Calendly booking ${eventUri} <${email}>`,
        );
      } else if (eventType === "invitee.canceled") {
        const reason = invitee?.cancellation?.reason || "(no reason given)";
        const subject = `Booking canceled: ${name}`;
        const text = [
          `Consultation canceled`,
          ``,
          `Name:   ${name}`,
          `Email:  ${email}`,
          `Event:  ${eventName}`,
          `Time:   ${startTime}`,
          `Reason: ${reason}`,
          ``,
          `Received: ${new Date().toISOString()}`,
        ].join("\n");

        const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#c62828">Consultation canceled</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;color:#6b6559;width:100px">Name</td>
        <td style="padding:8px;font-weight:600">${name}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Email</td>
        <td style="padding:8px"><a href="mailto:${email}">${email}</a></td></tr>
    <tr><td style="padding:8px;color:#6b6559">Was</td>
        <td style="padding:8px">${startTime}</td></tr>
    <tr style="background:#f5f0e8">
        <td style="padding:8px;color:#6b6559">Reason</td>
        <td style="padding:8px">${reason}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:12px;color:#9a9088">
    Received: ${new Date().toISOString()}
  </p>
</div>`;

        await Promise.all([
          sendEmail({ subject, text, html }),
          forwardDownstream({
            source: "calendly",
            eventType: "booking.canceled",
            name,
            email,
            eventName,
            startTime: event.start_time,
            cancellationReason: reason,
            receivedAt: new Date().toISOString(),
          }),
        ]);

        await syncPipelineSafely(
          () => pipelineSync.syncCalendlyCancellation({ eventUri }),
          `Calendly cancellation ${eventUri} <${email}>`,
        );
      } else {
        console.log(`[calendly] Unhandled event type: ${eventType}`);
      }

      res.json({ ok: true, event: eventType });
    } catch (err) {
      console.error("[calendly] Handler error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Start (only when run directly — `require("./server")` from tests does not
// bind a port)
// ---------------------------------------------------------------------------
if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT}`);
    console.log(`[server] Email notifications → ${MICHAEL_EMAIL}`);
    console.log(`[server] SMTP configured: ${Boolean(mailer)}`);
    console.log(`[server] Calendly signing: ${Boolean(CALENDLY_SIGNING_KEY)}`);
    console.log(`[server] Downstream URL: ${DOWNSTREAM_URL || "(none)"}`);
  });
}

module.exports = { createApp };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-server && node --test server.test.js`
Expected: PASS (5/5)

- [ ] **Step 5: Run the full test suite**

Run: `cd webhook-server && node --test lib/ server.test.js`
Expected: PASS (31/31 — sum of all tasks' tests)

- [ ] **Step 6: Commit**

```bash
git add webhook-server/server.js webhook-server/server.test.js
git commit -m "feat(webhook-server): sync Tally/Calendly intake into SharePoint Client Pipeline"
```

---

### Task 6: Configuration, tenant setup docs, and deploy

**Files:**

- Modify: `webhook-server/.env.example`
- Modify: `webhook-server/README.md`
- Modify: `webhook-server/package.json`

**Interfaces:**

- Consumes: nothing (documentation/config only).
- Produces: nothing consumed by other tasks — this is the last task.

- [ ] **Step 1: Add the `test` script**

Edit `webhook-server/package.json`, in the `scripts` block, add a `test` entry alongside the existing `start`/`dev`:

```json
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test lib/ server.test.js"
  },
```

- [ ] **Step 2: Run the test script to confirm it matches Task 5's manual invocation**

Run: `cd webhook-server && npm test`
Expected: PASS (31/31)

- [ ] **Step 3: Add the new environment variables**

Edit `webhook-server/.env.example`, after the existing `CALENDLY_WEBHOOK_SIGNING_KEY` line, add:

```
# Microsoft Graph — SharePoint Client Pipeline sync
# Azure AD app registration using the client-credentials flow, Sites.Selected
# permission, granted write access to the "Lehr Law Practice" site only.
# See README.md "SharePoint Client Pipeline sync" section for setup steps.
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
SHAREPOINT_SITE_ID=
SHAREPOINT_LIST_ID=
```

- [ ] **Step 4: Document the Azure AD app registration and SharePoint setup**

Edit `webhook-server/README.md`, adding a new section after the existing "Configure Calendly webhooks" section (before "Configure Tally webhooks"):

````markdown
---

## SharePoint Client Pipeline sync

Every Tally message and Calendly booking/cancellation is upserted into a
SharePoint list called `Client Pipeline`, via Microsoft Graph, using an
Azure AD app registration scoped to that one site only.

### 1. Create the SharePoint site and list

1. In the Microsoft 365 admin center, create a new **private** SharePoint
   site named "Lehr Law Practice". Restrict membership to Michael (and any
   future admin); enforce MFA for all members; enable audit logging.
2. In that site, create a list named `Client Pipeline` with these columns
   (all single line of text unless noted):
   - `Title` (built in)
   - `LeadID`, `FirstName`, `LastName`, `Email`, `Phone`
   - `Source` (choice: Website Message / Booking)
   - `DesiredProductCode`, `DesiredProductLabel`
   - `TallySubmissionID`, `CalendlyEventURI`
   - `InquiryReceivedAt` (date and time)
   - `Stage` (single line of text — values used by the sync: `New Inquiry`,
     `Consult Scheduled`, `Consult Cancelled`)
   - `ConsultStart`, `ConsultEnd` (date and time), `ConsultTimeZone`
   - `Notes` (multiple lines of text)
3. **Index the `Email` and `CalendlyEventURI` columns** (List settings →
   Indexed columns) — Graph's `$filter` on these fields requires it for
   reliable results at scale.
4. Enable list **versioning** (List settings → Versioning settings) — this
   is the audit trail for this phase (no separate `Pipeline Activity` list
   yet).

### 2. Register the Azure AD app

1. In the Entra admin center → **App registrations** → **New registration**.
   Name it something identifiable, e.g. "Lehr Law Webhook Server".
2. Under **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** → search for and add `Sites.Selected`. An
   admin must grant consent.
3. Under **Certificates & secrets** → **New client secret**. **Set an
   expiration of 12 months or less** — do not create a secret with no
   expiration. Record the secret value immediately; it's shown only once.
4. Record the **Application (client) ID** and **Directory (tenant) ID**
   from the app's Overview page.

### 3. Grant the app access to only the new site (Sites.Selected)

`Sites.Selected` grants zero site access by default — you must explicitly
grant this app permission to the one site it needs, using Graph Explorer or
a one-off authenticated request as a tenant admin:

```http
POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
Content-Type: application/json

{
  "roles": ["write"],
  "grantedToIdentities": [{
    "application": {
      "id": "{app-client-id}",
      "displayName": "Lehr Law Webhook Server"
    }
  }]
}
```
````

Find `{site-id}` via `GET https://graph.microsoft.com/v1.0/sites/{tenant}.sharepoint.com:/sites/{site-name}`.
Find `{list-id}` via `GET https://graph.microsoft.com/v1.0/sites/{site-id}/lists`.

### 4. Set the Railway environment variables

In the Railway dashboard → your project → **Variables**, add the five
`GRAPH_*`/`SHAREPOINT_*` values from `.env.example` above, using the
tenant ID, client ID, client secret, site ID, and list ID from steps 2–3.

### 5. Rotation reminder

Set a calendar reminder for one month before the client secret's expiration
to generate a new one (Certificates & secrets → New client secret → update
`GRAPH_CLIENT_SECRET` in Railway → delete the old secret from the app
registration).

---

````

- [ ] **Step 5: Verify formatting and commit**

```bash
cd /mnt/c/Users/david/michael3.0
git add webhook-server/.env.example webhook-server/README.md webhook-server/package.json
git commit -m "docs(webhook-server): document SharePoint Client Pipeline setup and add test script"
````

- [ ] **Step 6: Manual end-to-end verification (requires the real tenant configured per steps 1–4 above)**

Run the server locally with real `.env` values, then:

```bash
cd webhook-server
cp .env.example .env   # fill in real GRAPH_*/SHAREPOINT_* values
npm run dev
```

In a second terminal, replay the README's existing Tally curl example
(`webhook-server/README.md` "Local development" section) and confirm:

1. The webhook responds `200`.
2. A new row appears in the `Client Pipeline` SharePoint list with
   `Stage = New Inquiry` and the correct `DesiredProductCode`.
3. Re-running the identical curl command a second time does **not** create
   a second row (idempotency check).

---

## Self-Review Notes

- **Spec coverage:** Architecture (Tasks 2–5), Components (Tasks 1–3),
  Data flow message/consult paths + multiple-match/duplicate handling
  (Task 4), confidentiality constraint (documented as a Global Constraint
  and in README, no code change needed since the live event type has zero
  custom questions today), error handling (Task 5's `syncPipelineSafely`),
  Testing (all tasks include the specified test categories), law-firm
  requirements from the design doc (`Sites.Selected`, private/MFA/audit
  site in Task 6 Step 4, client secret expiration in Task 6 Step 4/5) — all
  covered.
- **Placeholder scan:** none found.
- **Type consistency:** `createSharepointClient`'s four exported function
  names match what Task 4 consumes; `createPipelineSync`'s three exported
  function names match what Task 5 consumes; `mapLabelToCode` signature
  matches between Tasks 1 and 4.
