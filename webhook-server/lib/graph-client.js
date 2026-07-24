"use strict";

// Generic Microsoft Graph HTTP client: client-credentials token acquisition
// (cached until near expiry) plus a thin authenticated-fetch wrapper.
// No SharePoint- or pipeline-specific knowledge lives here — see
// lib/sharepoint.js for that.
function createGraphClient({
  tenantId = process.env.GRAPH_TENANT_ID,
  clientId = process.env.GRAPH_CLIENT_ID,
  clientSecret = process.env.GRAPH_CLIENT_SECRET,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  let cachedToken = null; // { accessToken, expiresAt }

  async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > now() + 60_000) {
      return cachedToken.accessToken;
    }
    const res = await fetchImpl(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`[graph] Token request failed: ${res.status}`);
    }
    const data = await res.json();
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: now() + data.expires_in * 1000,
    };
    return cachedToken.accessToken;
  }

  async function graphFetch(path, options = {}) {
    const token = await getAccessToken();
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await (res.text ? res.text() : Promise.resolve(""));
      throw new Error(
        `[graph] ${options.method || "GET"} ${path} failed: ${res.status} ${body}`,
      );
    }
    // 204 (No Content) and 202 (Accepted, e.g. /sendMail) never carry a
    // JSON body — attempting to parse either would throw.
    return res.status === 204 || res.status === 202 ? null : res.json();
  }

  return { getAccessToken, graphFetch };
}

module.exports = { createGraphClient };
