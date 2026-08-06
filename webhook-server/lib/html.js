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

module.exports = { escapeHtml };
