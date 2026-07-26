"use strict";

const { createGraphClient } = require("./graph-client");

// Microsoft Graph change-notification subscription lifecycle for the
// Client Pipeline list. SharePoint list subscriptions allow expirations up
// to 42,300 minutes (~30 days); we request slightly less and re-check on a
// half-day cadence (see server.js), renewing anything within 48 hours of
// expiry — including immediately on process start, so a Railway restart
// that slept through a renewal tick still recovers.
const MAX_LIFETIME_MINUTES = 42_000; // just under Graph's 42,300-minute cap
const RENEW_WITHIN_MS = 48 * 60 * 60 * 1000;

function createSubscriptionsClient({
  graphClient = createGraphClient(),
  siteId = process.env.SHAREPOINT_SITE_ID,
  listId = process.env.SHAREPOINT_LIST_ID,
  notificationUrl = process.env.GRAPH_NOTIFICATION_URL,
  clientState = process.env.GRAPH_SUBSCRIPTION_CLIENT_STATE,
  now = () => Date.now(),
} = {}) {
  const resource = `sites/${siteId}/lists/${listId}`;

  function expirationFromNow() {
    return new Date(now() + MAX_LIFETIME_MINUTES * 60_000).toISOString();
  }

  async function listActiveSubscriptions() {
    const data = await graphClient.graphFetch("/subscriptions", {
      method: "GET",
    });
    return (data.value || []).filter((s) => s.resource === resource);
  }

  async function createSubscription() {
    return graphClient.graphFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "updated",
        notificationUrl,
        resource,
        expirationDateTime: expirationFromNow(),
        clientState,
      }),
    });
  }

  async function renewSubscription(subscriptionId) {
    return graphClient.graphFetch(`/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime: expirationFromNow() }),
    });
  }

  // Idempotent: creates a subscription if none exists for the list, renews
  // any expiring within RENEW_WITHIN_MS, leaves healthy ones alone.
  async function ensureSubscription() {
    const subs = await listActiveSubscriptions();
    if (subs.length === 0) {
      const created = await createSubscription();
      return { action: "created", id: created.id };
    }
    const results = [];
    for (const sub of subs) {
      const msLeft = Date.parse(sub.expirationDateTime) - now();
      if (msLeft < RENEW_WITHIN_MS) {
        await renewSubscription(sub.id);
        results.push({ action: "renewed", id: sub.id });
      } else {
        results.push({ action: "ok", id: sub.id });
      }
    }
    return { action: "checked", subscriptions: results };
  }

  return {
    listActiveSubscriptions,
    createSubscription,
    renewSubscription,
    ensureSubscription,
  };
}

module.exports = { createSubscriptionsClient };
