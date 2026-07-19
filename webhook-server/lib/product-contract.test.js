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
