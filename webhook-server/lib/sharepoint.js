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

  return {
    findOpenItemByEmail,
    findItemByCalendlyEventUri,
    createPipelineItem,
    updatePipelineItem,
  };
}

module.exports = { createSharepointClient };
