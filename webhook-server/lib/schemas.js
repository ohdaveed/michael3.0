"use strict";

// Structural validation for the three inbound webhook payloads.
//
// Before this, every handler read its fields with optional chaining and `||`
// defaults, so a malformed body produced empty strings that flowed all the
// way into an email and a SharePoint row instead of being rejected. These
// schemas fail fast at the route boundary.
//
// Every object here is `.loose()`, and that is load-bearing rather than
// stylistic. Zod strips undeclared keys by default, so a plain `.object()`
// validates the shape and then silently deletes everything it was not told
// about — including fields the handlers still read. That turned validation
// into data loss: `event.end_time` reached SharePoint as an undefined
// ConsultEnd, and `invitee.cancellation.reason` was dropped so every
// cancellation email read "(no reason given)".
//
// Declaring each of those individually would only fix the two we noticed.
// `.loose()` fixes the class: the shape is checked, unrecognised keys pass
// through untouched. That also matches the intent — Tally and Calendly add
// keys on their own release schedule, and neither rejecting nor discarding
// an unrecognised one is our call to make.
//
// **Keep new object schemas `.loose()`.** A bare `.object()` here will not
// fail a test; it will quietly delete a field somewhere downstream.

const { z } = require("zod");

// --- Tally ------------------------------------------------------------------

// A field's `value` is a string for text inputs, an array of option IDs for
// choice inputs, a number for numeric ones, or null when left blank.
// resolveTallyFieldValue() in server.js turns all of those into a string.
const tallyFieldSchema = z.looseObject({
  key: z.string().optional(),
  label: z.string(),
  type: z.string().optional(),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
    .optional(),
  options: z
    .array(z.looseObject({ id: z.string(), text: z.string() }))
    .optional(),
});

const tallyWebhookSchema = z.looseObject({
  eventId: z.string().optional(),
  createdAt: z.string().optional(),
  data: z.looseObject({
    submissionId: z.string().optional(),
    formId: z.string(),
    fields: z.array(tallyFieldSchema).default([]),
  }),
});

// --- Calendly ---------------------------------------------------------------

const calendlyWebhookSchema = z.looseObject({
  event: z.string(),
  payload: z
    .looseObject({
      uri: z.string().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
      first_name: z.string().nullish(),
      last_name: z.string().nullish(),
      cancel_url: z.string().optional(),
      reschedule_url: z.string().optional(),
      // Present on invitee.* events; the handler reads name/email off it.
      invitee: z
        .looseObject({
          name: z.string().optional(),
          first_name: z.string().nullish(),
          last_name: z.string().nullish(),
          email: z.string().optional(),
        })
        .optional(),
      // Calendly sends this two ways depending on how the hook is wired: an
      // expanded object when something upstream enriches the payload (what
      // server.test.js's fixture models), or the bare scheduled-event URI
      // string on a direct v2 invitee.* delivery. Accept both.
      //
      // This must stay a union. Before validation existed the handler read
      // `payload.event || {}` and a string simply degraded start_time to
      // "(unknown)"; rejecting the string outright would turn that graceful
      // degradation into a 400 that drops a real booking on the floor.
      event: z
        .union([
          z.string(),
          z.looseObject({
            name: z.string().optional(),
            start_time: z.string().optional(),
          }),
        ])
        .optional(),
      questions_and_answers: z
        .array(
          z.looseObject({
            question: z.string().default(""),
            answer: z.string().nullish(),
          }),
        )
        .optional(),
    })
    .default({}),
});

// --- Microsoft Graph change notifications -----------------------------------

const graphNotificationSchema = z.looseObject({
  value: z
    .array(
      z.looseObject({
        clientState: z.string().nullish(),
        resource: z.string().optional(),
        resourceData: z.looseObject({ id: z.string().optional() }).nullish(),
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
