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

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Paths are matched literally, so every place a value is logged has to use
  // one of these key names. Keep new PII on an existing key rather than
  // inventing one the redactor does not know about.
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
});

module.exports = { logger };
