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
