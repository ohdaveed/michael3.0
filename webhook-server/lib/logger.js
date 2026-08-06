"use strict";

// Structured logging. Railway captures stdout, so pino's default JSON
// destination is all that is needed — no transport, and pino-pretty stays out
// of the production dependency tree.
//
// The redaction list is the point of this module, not a bonus: this service
// handles prospective-client contact details for a law firm, and the Tally and
// Calendly handlers previously logged the lead's name and email in plain text
// on every submission. Those paths now log through `logger.child({ scope })`
// with the identifying fields under keys named below, so they are replaced
// with [redacted] before anything reaches the log.

const pino = require("pino");

const LEVEL = process.env.LOG_LEVEL || "info";

function redactConfig() {
  return {
    // Paths are matched literally, so every place a value is logged has to use
    // one of these key names. Keep new PII on an existing key rather than
    // inventing one the redactor does not know about.
    paths: [
      "email",
      "name",
      "firstName",
      "lastName",
      "phone",
      "message",
      // Email subjects are built from the lead's name in server.js
      // ("New message from Jane Doe — Will Only"), so logging one leaks the
      // same identity the fields above are redacted to protect.
      "subject",
      "*.email",
      "*.name",
      "*.firstName",
      "*.lastName",
      "*.phone",
      "*.message",
      "*.subject",
    ],
    censor: "[redacted]",
  };
}

// Exported so the tests exercise this configuration rather than a copy of it —
// a duplicated redact list in the test would keep passing after a change here,
// which defeats the point of testing a privacy control.
function createLogger(destination) {
  return destination
    ? pino({ level: LEVEL, redact: redactConfig() }, destination)
    : pino({ level: LEVEL, redact: redactConfig() });
}

const logger = createLogger();

module.exports = { logger, createLogger };
