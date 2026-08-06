"use strict";

// Escaping for values interpolated into the HTML email bodies. Everything
// that reaches these templates originates in a webhook payload — a contact
// form or a Calendly booking — so none of it can be trusted as markup.
//
// Single quotes are escaped too because values land inside attribute values
// (the mailto: href in the notification email), not only in text nodes.
const ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

// escapeHtml makes a value safe as attribute *syntax*, but an href also
// carries a scheme, and `javascript:` survives escaping intact. Anything
// interpolated into an href needs this instead: it returns the URL only when
// it parses as https, and "" otherwise so the caller can drop the link.
//
// The scheme is what matters here, not the host — Calendly action URLs have
// moved domains before, and pinning one would silently break real links for
// no extra safety.
function safeHttpsUrl(value) {
  if (!value) return "";
  try {
    return new URL(String(value)).protocol === "https:" ? String(value) : "";
  } catch {
    return "";
  }
}

// Email subjects reach Microsoft Graph as a JSON string, so CR/LF cannot
// forge headers the way it would over raw SMTP. It still produces a mangled
// subject line, and the values come from webhook payloads, so collapse any
// control characters to spaces.
function singleLine(value) {
  // eslint-disable-next-line no-control-regex
  return String(value)
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim();
}

module.exports = { escapeHtml, safeHttpsUrl, singleLine };
