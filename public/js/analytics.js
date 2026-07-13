// GA4 custom events. Codes and locations only — never send names, email
// addresses, phone numbers, message content, or booking/matter IDs.
document.addEventListener("click", (event) => {
  const link = event.target.closest('a[data-cta="book-consult"]');
  if (!link || typeof window.gtag !== "function") return;

  const section = link.closest("section[class], nav, footer");
  const sectionName = section
    ? section.id || section.className.split(" ")[0] || section.tagName
    : "page";
  window.gtag("event", "book_consult_click", {
    link_location: sectionName,
    page_path: window.location.pathname,
  });
  // Booking links open in a new tab, so there is no navigation race with
  // the event being sent.
});
