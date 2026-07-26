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
