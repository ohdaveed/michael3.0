// Single source of truth for the consultation booking destination.
//
// This is Michael's Calendly scheduling page. Swap the URL here if the
// destination ever changes — every CTA on the site picks it up: HTML via
// the {{BOOKING_URL}} token substituted in vite.config.js, and scripts via
// this import.
export const BOOKING_URL =
  "https://calendly.com/lehrlaw/estate-planning-consultation";
