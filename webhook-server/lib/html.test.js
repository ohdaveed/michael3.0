"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { escapeHtml } = require("./html");

test("escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("escapes ampersands once, not recursively", () => {
  assert.equal(escapeHtml("Trusts & Estates"), "Trusts &amp; Estates");
  assert.equal(escapeHtml("&amp;"), "&amp;amp;");
});

test("neutralises a script tag submitted through a form field", () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
  );
});

test("escapes quotes so a value cannot break out of an attribute", () => {
  assert.equal(
    escapeHtml('" onmouseover="steal()'),
    "&quot; onmouseover=&quot;steal()",
  );
  assert.equal(escapeHtml("' onfocus='x"), "&#39; onfocus=&#39;x");
});

test("coerces non-strings rather than throwing", () => {
  assert.equal(escapeHtml(42), "42");
  assert.equal(escapeHtml(null), "null");
  assert.equal(escapeHtml(undefined), "undefined");
});

test("leaves ordinary text untouched", () => {
  assert.equal(escapeHtml("Jane Doe"), "Jane Doe");
  assert.equal(escapeHtml(""), "");
});
