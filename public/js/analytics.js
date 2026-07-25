// GA4 custom events. Codes and locations only — never send names, email
// addresses, phone numbers, message content, or booking/matter IDs.
function linkLocation(link) {
  const section = link.closest("section[class], nav, footer");
  return section
    ? section.id || section.className.split(" ")[0] || section.tagName
    : "page";
}

document.addEventListener("click", (event) => {
  if (typeof window.gtag !== "function") return;

  const bookLink = event.target.closest('a[data-cta="book-consult"]');
  if (bookLink) {
    window.gtag("event", "book_consult_click", {
      link_location: linkLocation(bookLink),
      page_path: window.location.pathname,
    });
    // Booking links open in a new tab, so there is no navigation race with
    // the event being sent.
    return;
  }

  const telLink = event.target.closest('a[href^="tel:"]');
  if (telLink) {
    window.gtag("event", "phone_click", {
      link_location: linkLocation(telLink),
      page_path: window.location.pathname,
    });
    return;
  }

  const mailLink = event.target.closest('a[href^="mailto:"]');
  if (mailLink) {
    window.gtag("event", "email_click", {
      link_location: linkLocation(mailLink),
      page_path: window.location.pathname,
    });
  }
});
