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

// --- safeHttpsUrl -----------------------------------------------------------

const { safeHttpsUrl, singleLine } = require("./html");

test("passes through an https URL", () => {
  assert.equal(
    safeHttpsUrl("https://calendly.com/cancellations/abc"),
    "https://calendly.com/cancellations/abc",
  );
});

test("rejects schemes that escaping cannot neutralise", () => {
  // escapeHtml leaves these intact — the scheme is the whole risk in an href.
  assert.equal(safeHttpsUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpsUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(safeHttpsUrl("http://calendly.com/x"), "");
});

test("rejects unparseable or absent values", () => {
  assert.equal(safeHttpsUrl("not a url"), "");
  assert.equal(safeHttpsUrl(""), "");
  assert.equal(safeHttpsUrl(undefined), "");
  assert.equal(safeHttpsUrl(null), "");
});

// --- singleLine -------------------------------------------------------------

test("collapses control characters in a subject line", () => {
  assert.equal(
    singleLine("New booking: Jane\r\nBcc: evil@example.com"),
    "New booking: Jane Bcc: evil@example.com",
  );
  assert.equal(singleLine("Tabs\tand\nnewlines"), "Tabs and newlines");
});

test("leaves an ordinary subject untouched", () => {
  assert.equal(
    singleLine("New message from Jane Doe — Will Only"),
    "New message from Jane Doe — Will Only",
  );
});
