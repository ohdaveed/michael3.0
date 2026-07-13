// Single source of truth for the consultation booking destination.
//
// Today this is Michael's personal Microsoft "Bookings with me" page. When
// the shared Microsoft Bookings page (which supports Power Automate triggers
// and custom intake questions) is created, swap the URL here — every CTA on
// the site picks it up: HTML via the {{BOOKING_URL}} token substituted in
// vite.config.js, and scripts via this import.
export const BOOKING_URL =
  "https://outlook.office.com/bookwithme/user/0b9bd49f7de44f3a91a007a517b326f3@lehr-law.com?anonymous&ismsaljsauthenabled&ep=plink";
