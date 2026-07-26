"use strict";

const { createGraphClient } = require("./graph-client");

// Client for the `Pipeline Activity` SharePoint list (client-pipeline.md
// §4.2) — the append-only audit trail and idempotency ledger. The stage
// engine checks EventKey here before acting and records every outcome.
//
// FIELDS maps our names to the list's internal column names, verified
// against the live list's GET /sites/{site}/lists/{list}/columns on
// 2026-07-26 — correct them here if the list ever changes. The
// pipeline-item reference is the §4.2 lookup column (internal name
// `PipelineItem`), written via Graph's `<Field>LookupId` form, which
// takes the referenced item's numeric list-item id.
const FIELDS = {
  title: "Title",
  pipelineItemId: "PipelineItemLookupId",
  eventType: "EventType",
  eventSource: "EventSource",
  eventTimestamp: "EventTimestamp",
  actorOrFlow: "ActorOrFlow",
  eventKey: "EventKey",
  summary: "Summary",
  outcome: "Outcome",
  errorDetails: "ErrorDetails",
};

function createPipelineActivityClient({
  graphClient = createGraphClient(),
  siteId = process.env.SHAREPOINT_SITE_ID,
  listId = process.env.SHAREPOINT_ACTIVITY_LIST_ID,
} = {}) {
  async function findSuccessByEventKey(eventKey) {
    const escapedKey = eventKey.replace(/'/g, "''");
    const filterValue = `fields/${FIELDS.eventKey} eq '${escapedKey}' and fields/${FIELDS.outcome} eq 'Success'`;
    // encodeURIComponent (not URLSearchParams) — see lib/sharepoint.js for
    // why (`+` vs `%20` round-tripping).
    const encodedFilter = encodeURIComponent(filterValue);
    const path = `/sites/${siteId}/lists/${listId}/items?expand=fields&$filter=${encodedFilter}`;
    const data = await graphClient.graphFetch(path, {
      method: "GET",
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
    });
    return (data.value || [])[0] || null;
  }

  async function recordActivity({
    pipelineItemId,
    eventType,
    eventKey,
    summary,
    outcome,
    errorDetails = "",
  }) {
    return graphClient.graphFetch(`/sites/${siteId}/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          [FIELDS.title]: summary,
          [FIELDS.pipelineItemId]: Number(pipelineItemId),
          [FIELDS.eventType]: eventType,
          [FIELDS.eventSource]: "webhook-server",
          [FIELDS.eventTimestamp]: new Date().toISOString(),
          [FIELDS.actorOrFlow]: "stage-engine",
          [FIELDS.eventKey]: eventKey,
          [FIELDS.summary]: summary,
          [FIELDS.outcome]: outcome,
          [FIELDS.errorDetails]: errorDetails,
        },
      }),
    });
  }

  return { findSuccessByEventKey, recordActivity };
}

module.exports = { createPipelineActivityClient };
