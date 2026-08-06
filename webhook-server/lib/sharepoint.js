"use strict";

const { createGraphClient } = require("./graph-client");

const SITE_ID = process.env.SHAREPOINT_SITE_ID;
const LIST_ID = process.env.SHAREPOINT_LIST_ID;

// Closed stages are excluded from "open item" matching — a matter in any
// of these stages is done and shouldn't receive further intake updates.
// "Consult Cancelled" is deliberately NOT in this list: a cancelled
// consult can still be rebooked, so the row stays open.
const CLOSED_STAGES = ["Complete", "Declined", "Not a Fit", "No Response"];

function createSharepointClient({ graphClient = createGraphClient() } = {}) {
  async function findOpenItemByEmail(email) {
    const escapedEmail = email.replace(/'/g, "''");
    const closedFilter = CLOSED_STAGES.map(
      (s) => `fields/Stage ne '${s}'`,
    ).join(" and ");
    const filterValue = `fields/Email eq '${escapedEmail}' and ${closedFilter}`;
    // encodeURIComponent (not URLSearchParams) — URLSearchParams encodes
    // spaces as `+`, which callers' decodeURIComponent-based path
    // inspection cannot reverse (only %20 round-trips correctly).
    const encodedFilter = encodeURIComponent(filterValue);
    const path = `/sites/${SITE_ID}/lists/${LIST_ID}/items?expand=fields&$filter=${encodedFilter}`;
    const data = await graphClient.graphFetch(path, {
      method: "GET",
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
    });
    return data.value || [];
  }

  async function findItemByCalendlyEventUri(uri) {
    const escapedUri = uri.replace(/'/g, "''");
    const filterValue = `fields/CalendlyEventURI eq '${escapedUri}'`;
    // encodeURIComponent (not URLSearchParams) — URLSearchParams encodes
    // spaces as `+`, which callers' decodeURIComponent-based path
    // inspection cannot reverse (only %20 round-trips correctly).
    const encodedFilter = encodeURIComponent(filterValue);
    const path = `/sites/${SITE_ID}/lists/${LIST_ID}/items?expand=fields&$filter=${encodedFilter}`;
    const data = await graphClient.graphFetch(path, {
      method: "GET",
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
    });
    return (data.value || [])[0] || null;
  }

  async function createPipelineItem(fields) {
    return graphClient.graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}/items`, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
  }

  async function updatePipelineItem(itemId, fields) {
    return graphClient.graphFetch(
      `/sites/${SITE_ID}/lists/${LIST_ID}/items/${itemId}/fields`,
      { method: "PATCH", body: JSON.stringify(fields) },
    );
  }

  // Delta query over the Client Pipeline list. Graph list-change
  // notifications never include the changed data itself (resourceData is
  // empty for list resources), so every notification triggers a delta
  // fetch to learn what actually changed. Pass the deltaLink returned by
  // the previous call to get only changes since then; pass null for a
  // full baseline sync. `reset: true` signals a 410 Gone (expired delta
  // token, a documented delta behavior) — the caller must restart from
  // null.
  const GRAPH_ORIGIN = "https://graph.microsoft.com/v1.0";

  async function fetchListDelta(deltaLink) {
    const items = [];
    let path = deltaLink
      ? deltaLink.replace(GRAPH_ORIGIN, "")
      : `/sites/${SITE_ID}/lists/${LIST_ID}/items/delta?expand=fields`;
    for (;;) {
      let data;
      try {
        data = await graphClient.graphFetch(path, { method: "GET" });
      } catch (err) {
        // 410 Gone = the delta token expired; Graph wants a full resync.
        // graphFetch attaches err.status, so this reads the code rather than
        // pattern-matching the error message. The message check stays as a
        // fallback for any error that reaches here without a status.
        if (err.status === 410 || /failed: 410\b/.test(String(err.message))) {
          return { reset: true, items: [], deltaLink: null };
        }
        throw err;
      }
      items.push(...(data.value || []));
      if (data["@odata.nextLink"]) {
        path = data["@odata.nextLink"].replace(GRAPH_ORIGIN, "");
      } else {
        return {
          reset: false,
          items,
          deltaLink: data["@odata.deltaLink"] || null,
        };
      }
    }
  }

  return {
    findOpenItemByEmail,
    findItemByCalendlyEventUri,
    createPipelineItem,
    updatePipelineItem,
    fetchListDelta,
  };
}

module.exports = { createSharepointClient };
