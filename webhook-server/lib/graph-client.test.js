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

// --- Throttling / retry -----------------------------------------------------

function tokenResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: "tok", expires_in: 3600 }),
  };
}

// Minimal stand-in for the Headers object graphFetch reads Retry-After from.
function headers(map = {}) {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

test("retries a 429 and returns the eventual success", async () => {
  const slept = [];
  const responses = [
    { ok: false, status: 429, headers: headers({ "retry-after": "2" }) },
    { ok: true, status: 200, json: async () => ({ value: "done" }) },
  ];
  let call = 0;
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) =>
      url.includes("login.microsoftonline.com")
        ? tokenResponse()
        : responses[call++],
    sleep: async (ms) => slept.push(ms),
  });

  assert.deepEqual(await client.graphFetch("/thing"), { value: "done" });
  // Retry-After: 2 seconds, honoured in preference to the backoff schedule.
  assert.deepEqual(slept, [2000]);
});

test("falls back to exponential backoff when Retry-After is absent", async () => {
  const slept = [];
  let call = 0;
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) => {
      if (url.includes("login.microsoftonline.com")) return tokenResponse();
      call++;
      return call <= 2
        ? { ok: false, status: 503, headers: headers() }
        : { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    },
    sleep: async (ms) => slept.push(ms),
  });

  assert.deepEqual(await client.graphFetch("/thing"), { ok: 1 });
  assert.deepEqual(slept, [500, 1000]);
});

test("gives up after the retry budget and throws with the status attached", async () => {
  const slept = [];
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) =>
      url.includes("login.microsoftonline.com")
        ? tokenResponse()
        : {
            ok: false,
            status: 429,
            headers: headers(),
            text: async () => "throttled",
          },
    sleep: async (ms) => slept.push(ms),
  });

  await assert.rejects(
    () => client.graphFetch("/thing"),
    (err) => err.status === 429 && /throttled/.test(err.message),
  );
  // MAX_RETRIES = 3, so three waits then the throw.
  assert.equal(slept.length, 3);
});

test("does not retry a non-transient status and attaches it to the error", async () => {
  let calls = 0;
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) => {
      if (url.includes("login.microsoftonline.com")) return tokenResponse();
      calls++;
      return {
        ok: false,
        status: 410,
        headers: headers(),
        text: async () => "gone",
      };
    },
    sleep: async () => assert.fail("must not sleep for a 410"),
  });

  await assert.rejects(
    () => client.graphFetch("/delta"),
    (err) => err.status === 410,
  );
  assert.equal(calls, 1);
});

test("caps the backoff wait", async () => {
  const slept = [];
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) =>
      url.includes("login.microsoftonline.com")
        ? tokenResponse()
        : {
            ok: false,
            status: 429,
            // Far beyond MAX_BACKOFF_MS — a hostile or buggy header must not
            // park the request for an hour.
            headers: headers({ "retry-after": "3600" }),
            text: async () => "",
          },
    sleep: async (ms) => slept.push(ms),
  });

  await assert.rejects(() => client.graphFetch("/thing"));
  assert.deepEqual(slept, [20_000, 20_000, 20_000]);
});

test("does not retry an ambiguous 503 for a POST", async () => {
  // /sendMail and list-item creation are POSTs with no client-side dedupe key.
  // A 503 may mean the request was processed and only the response lost, so
  // replaying it risks a second email to a prospective client.
  let calls = 0;
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) => {
      if (url.includes("login.microsoftonline.com")) return tokenResponse();
      calls++;
      return {
        ok: false,
        status: 503,
        headers: headers(),
        text: async () => "unavailable",
      };
    },
    sleep: async () => assert.fail("must not retry a POST on 503"),
  });

  await assert.rejects(
    () => client.graphFetch("/users/x/sendMail", { method: "POST" }),
    (err) => err.status === 503,
  );
  assert.equal(calls, 1);
});

test("still retries a 429 for a POST, since a throttle means it never ran", async () => {
  const slept = [];
  let call = 0;
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) => {
      if (url.includes("login.microsoftonline.com")) return tokenResponse();
      call++;
      return call === 1
        ? { ok: false, status: 429, headers: headers({ "retry-after": "1" }) }
        : { ok: true, status: 202, json: async () => ({}) };
    },
    sleep: async (ms) => slept.push(ms),
  });

  assert.equal(
    await client.graphFetch("/users/x/sendMail", { method: "POST" }),
    null,
  );
  assert.deepEqual(slept, [1000]);
});

test("retries an ambiguous 504 for an idempotent GET", async () => {
  const slept = [];
  let call = 0;
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) => {
      if (url.includes("login.microsoftonline.com")) return tokenResponse();
      call++;
      return call === 1
        ? { ok: false, status: 504, headers: headers() }
        : { ok: true, status: 200, json: async () => ({ value: [] }) };
    },
    sleep: async (ms) => slept.push(ms),
  });

  assert.deepEqual(await client.graphFetch("/items/delta", { method: "GET" }), {
    value: [],
  });
  assert.deepEqual(slept, [500]);
});

test("honours an HTTP-date Retry-After against the injected clock", async () => {
  const slept = [];
  // Fixed clock so the date arithmetic is deterministic: the header is 4s ahead.
  const fixedNow = Date.parse("2026-08-06T12:00:00Z");
  let call = 0;
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    now: () => fixedNow,
    fetchImpl: async (url) => {
      if (url.includes("login.microsoftonline.com")) return tokenResponse();
      call++;
      return call === 1
        ? {
            ok: false,
            status: 429,
            headers: headers({
              "retry-after": "Thu, 06 Aug 2026 12:00:04 GMT",
            }),
          }
        : { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    },
    sleep: async (ms) => slept.push(ms),
  });

  assert.deepEqual(await client.graphFetch("/thing"), { ok: 1 });
  assert.deepEqual(slept, [4000]);
});

test("ignores an unparseable Retry-After and falls back to backoff", async () => {
  const slept = [];
  let call = 0;
  const client = createGraphClient({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: async (url) => {
      if (url.includes("login.microsoftonline.com")) return tokenResponse();
      call++;
      return call === 1
        ? {
            ok: false,
            status: 429,
            headers: headers({ "retry-after": "soon" }),
          }
        : { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    },
    sleep: async (ms) => slept.push(ms),
  });

  assert.deepEqual(await client.graphFetch("/thing"), { ok: 1 });
  // Garbage header must not become NaN and skip the wait entirely.
  assert.deepEqual(slept, [500]);
});
