"use strict";

// Structural validation for the three inbound webhook payloads.
//
// Before this, every handler read its fields with optional chaining and `||`
// defaults, so a malformed body produced empty strings that flowed all the
// way into an email and a SharePoint row instead of being rejected. These
// schemas fail fast at the route boundary.
//
// They are deliberately permissive about fields the handlers do not read:
// Tally and Calendly both add keys over time, and rejecting an unrecognised
// one would break the integration on their release schedule, not ours. What
// is validated is what the handlers actually depend on.

const { z } = require("zod");

// --- Tally ------------------------------------------------------------------

// A field's `value` is a string for text inputs, an array of option IDs for
// choice inputs, a number for numeric ones, or null when left blank.
// resolveTallyFieldValue() in server.js turns all of those into a string.
const tallyFieldSchema = z.object({
  key: z.string().optional(),
  label: z.string(),
  type: z.string().optional(),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
    .optional(),
  options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
});

const tallyWebhookSchema = z.object({
  eventId: z.string().optional(),
  createdAt: z.string().optional(),
  data: z.object({
    submissionId: z.string().optional(),
    formId: z.string(),
    fields: z.array(tallyFieldSchema).default([]),
  }),
});

// --- Calendly ---------------------------------------------------------------

const calendlyWebhookSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      uri: z.string().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
      first_name: z.string().nullish(),
      last_name: z.string().nullish(),
      cancel_url: z.string().optional(),
      reschedule_url: z.string().optional(),
      // Present on invitee.* events; the handler reads name/email off it.
      invitee: z
        .object({
          name: z.string().optional(),
          first_name: z.string().nullish(),
          last_name: z.string().nullish(),
          email: z.string().optional(),
        })
        .optional(),
      event: z
        .object({
          name: z.string().optional(),
          start_time: z.string().optional(),
        })
        .optional(),
      questions_and_answers: z
        .array(
          z.object({
            question: z.string().default(""),
            answer: z.string().nullish(),
          }),
        )
        .optional(),
    })
    .default({}),
});

// --- Microsoft Graph change notifications -----------------------------------

const graphNotificationSchema = z.object({
  value: z
    .array(
      z.object({
        clientState: z.string().nullish(),
        resource: z.string().optional(),
        resourceData: z.object({ id: z.string().optional() }).nullish(),
        subscriptionId: z.string().optional(),
        changeType: z.string().optional(),
      }),
    )
    .default([]),
});

// Returns { ok: true, data } or { ok: false, error } so callers branch on a
// value instead of try/catch — the handlers already own their error paths.
function parse(schema, body) {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  return {
    ok: false,
    error: first
      ? `${first.path.join(".") || "body"}: ${first.message}`
      : "invalid payload",
  };
}

module.exports = {
  tallyWebhookSchema,
  calendlyWebhookSchema,
  graphNotificationSchema,
  parseTallyWebhook: (body) => parse(tallyWebhookSchema, body),
  parseCalendlyWebhook: (body) => parse(calendlyWebhookSchema, body),
  parseGraphNotification: (body) => parse(graphNotificationSchema, body),
};
