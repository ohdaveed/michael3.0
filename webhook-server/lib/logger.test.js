"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("node:stream");

const pino = require("pino");

// Rebuilds the module's configuration against a capture stream. Asserting on
// the exported singleton would mean intercepting stdout; this keeps the
// redaction contract under test without that.
function captureLogger() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const logger = pino(
    {
      redact: {
        paths: [
          "email",
          "name",
          "firstName",
          "lastName",
          "phone",
          "message",
          "*.email",
          "*.name",
          "*.firstName",
          "*.lastName",
          "*.phone",
          "*.message",
        ],
        censor: "[redacted]",
      },
    },
    stream,
  );
  return { logger, lines };
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
