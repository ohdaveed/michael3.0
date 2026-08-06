"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("node:stream");

const { createLogger } = require("./logger");

// Uses the module's own factory rather than rebuilding its config here. An
// inlined copy of the redact list would keep these tests passing after a
// change to logger.js, which would defeat the point of testing a privacy
// control — the assertions must fail if production redaction regresses.
function captureLogger() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { logger: createLogger(stream), lines };
}

test("redacts lead contact details at the top level", () => {
  const { logger, lines } = captureLogger();
  logger.info(
    { email: "jane@example.com", firstName: "Jane", phone: "415-555-0100" },
    "submission",
  );
  assert.equal(lines[0].email, "[redacted]");
  assert.equal(lines[0].firstName, "[redacted]");
  assert.equal(lines[0].phone, "[redacted]");
});

test("redacts contact details nested one level down", () => {
  const { logger, lines } = captureLogger();
  logger.info(
    { lead: { email: "jane@example.com", name: "Jane Doe" } },
    "sync",
  );
  assert.equal(lines[0].lead.email, "[redacted]");
  assert.equal(lines[0].lead.name, "[redacted]");
});

test("redacts free-text message bodies", () => {
  const { logger, lines } = captureLogger();
  logger.info({ message: "My mother passed away last week" }, "submission");
  assert.equal(lines[0].message, "[redacted]");
});

test("leaves non-identifying operational fields intact", () => {
  const { logger, lines } = captureLogger();
  logger.info(
    { scope: "tally", submissionId: "sub_123", productCode: "WILL_ONLY" },
    "received",
  );
  assert.equal(lines[0].scope, "tally");
  assert.equal(lines[0].submissionId, "sub_123");
  assert.equal(lines[0].productCode, "WILL_ONLY");
});

test("redacts the email subject, which is built from the lead's name", () => {
  const { logger, lines } = captureLogger();
  // server.js builds subjects like "New message from Jane Doe — Will Only",
  // so an unredacted subject leaks the same identity as the name field.
  logger.info({ scope: "email", subject: "New message from Jane Doe" }, "sent");
  assert.equal(lines[0].subject, "[redacted]");
  assert.equal(lines[0].scope, "email");
});
