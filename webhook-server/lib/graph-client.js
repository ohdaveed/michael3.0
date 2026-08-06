"use strict";

// Generic Microsoft Graph HTTP client: client-credentials token acquisition
// (cached until near expiry) plus a thin authenticated-fetch wrapper.
// No SharePoint- or pipeline-specific knowledge lives here — see
// lib/sharepoint.js for that.
// Graph throttles with 429 + Retry-After and sheds load with 503/504. Those
// are transient by definition, so retry them; everything else (401, 404, the
// 410 an expired delta token produces) is a real answer and is thrown at once.
const RETRYABLE_STATUSES = new Set([429, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20_000;

// Retry-After is seconds or an HTTP-date. Graph sends seconds in practice;
// the date form is handled so an unexpected one does not become NaN and skip
// the wait entirely. Returns null when the header is absent or unparseable,
// leaving the caller on exponential backoff.
function parseRetryAfter(header, nowMs) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

function createGraphClient({
  tenantId = process.env.GRAPH_TENANT_ID,
  clientId = process.env.GRAPH_CLIENT_ID,
  clientSecret = process.env.GRAPH_CLIENT_SECRET,
  fetchImpl = fetch,
  now = () => Date.now(),
  // Injectable so tests exercise the retry path without real delays.
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
    for (let attempt = 0; ; attempt++) {
      const token = await getAccessToken();
      const res = await fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });

      if (res.ok) {
        // 204 (No Content) and 202 (Accepted, e.g. /sendMail) never carry a
        // JSON body — attempting to parse either would throw.
        return res.status === 204 || res.status === 202 ? null : res.json();
      }

      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        const headerWait = parseRetryAfter(
          res.headers && res.headers.get
            ? res.headers.get("retry-after")
            : null,
          now(),
        );
        // Graph's own Retry-After wins when present; it knows the throttle
        // window. Otherwise back off exponentially from BASE_BACKOFF_MS.
        const wait = Math.min(
          headerWait ?? BASE_BACKOFF_MS * 2 ** attempt,
          MAX_BACKOFF_MS,
        );
        await sleep(wait);
        continue;
      }

      const body = await (res.text ? res.text() : Promise.resolve(""));
      const err = new Error(
        `[graph] ${options.method || "GET"} ${path} failed: ${res.status} ${body}`,
      );
      // Carried so callers can branch on the code instead of regex-matching
      // this message — lib/sharepoint.js reads it to detect an expired
      // delta token (410).
      err.status = res.status;
      throw err;
    }
  }

  return { getAccessToken, graphFetch };
}

module.exports = { createGraphClient };
