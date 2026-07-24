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

test("graphFetch returns null for a 202 Accepted response", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "abc123", expires_in: 3600 }),
      };
    }
    return { ok: true, status: 202 };
  };
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl,
    now: () => 0,
  });

  const result = await client.graphFetch("/users/x/sendMail", {
    method: "POST",
    body: "{}",
  });

  assert.equal(result, null);
});
