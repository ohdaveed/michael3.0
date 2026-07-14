// Loads Tally's embed widget for the contact form iframe and handles
// submission events. Only contact.html has a [data-tally-src] iframe, so
// this is a no-op on every other page.
const embeds = document.querySelectorAll("iframe[data-tally-src]:not([src])");

if (embeds.length > 0) {
  const WIDGET_SRC = "https://tally.so/widgets/embed.js";

  const loadEmbeds = () => {
    if (typeof window.Tally !== "undefined") {
      window.Tally.loadEmbeds();
    } else {
      // Widget blocked or failed — point the iframes at the form directly.
      embeds.forEach((iframe) => {
        iframe.src = iframe.dataset.tallySrc;
      });
    }
  };

  if (typeof window.Tally !== "undefined") {
    loadEmbeds();
  } else if (!document.querySelector(`script[src="${WIDGET_SRC}"]`)) {
    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.onload = loadEmbeds;
    script.onerror = loadEmbeds;
    document.body.appendChild(script);
    // If the widget hangs (blocked, slow network), don't leave an empty
    // form area — point the iframes at the form directly.
    setTimeout(loadEmbeds, 3000);
  }

  window.addEventListener("message", (event) => {
    if (
      event.origin !== "https://tally.so" ||
      typeof event.data !== "string" ||
      !event.data.includes("Tally.FormSubmitted")
    ) {
      return;
    }
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!data || data.event !== "Tally.FormSubmitted") return;

    // Codes only — never send names, emails, phones, or message content
    // to analytics.
    if (typeof window.gtag === "function") {
      window.gtag("event", "generate_lead", { method: "contact_form" });
    }
    // Tally's redirect-on-completion applies inside the iframe; navigate
    // the page itself so the visitor lands on the thank-you page.
    setTimeout(() => {
      window.location.assign(
        new URL("thank-you.html", window.location.href).href,
      );
    }, 400);
  });
}
