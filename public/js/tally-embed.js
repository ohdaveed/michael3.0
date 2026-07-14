import productContract from "./product-contract.json";

// Loads Tally's embed widget for the contact form iframe and handles
// submission events. Only contact.html has a [data-tally-src] iframe, so
// this is a no-op on every other page.
const embeds = document.querySelectorAll("iframe[data-tally-src]:not([src])");

if (embeds.length > 0) {
  // Practice-area cards on services.html link here with ?service=<code> so
  // the embedded form arrives with "Service needed" already selected. Tally
  // prefill needs the option's *label* text via a hidden field the
  // dropdown's Default answer is configured from — not our stable code —
  // so translate before it ever reaches the iframe src. The hidden field
  // is named "service_label", not "service": Tally's widget separately
  // auto-forwards this page's own query string onto the iframe verbatim,
  // so reusing "service" would append a second, colliding `service=<code>`
  // that clobbers the translated label.
  const requestedCode = new URLSearchParams(window.location.search).get(
    "service",
  );
  const requestedProduct = productContract.products.find(
    (p) => p.code === requestedCode,
  );
  if (requestedProduct) {
    embeds.forEach((iframe) => {
      const src = new URL(iframe.dataset.tallySrc);
      src.searchParams.set("service_label", requestedProduct.label);
      iframe.dataset.tallySrc = src.toString();
    });
  }

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

    // Tally's redirect-on-completion applies inside the iframe; navigate
    // the page itself so the visitor lands on the thank-you page. Wait
    // for the analytics event callback (or the timeout, if gtag is
    // blocked and never calls back) so the lead event isn't lost to the
    // redirect. Codes only — never send names, emails, phones, or
    // message content to analytics.
    const thankYou = new URL("thank-you.html", window.location.href);
    let navigated = false;
    const navigate = () => {
      if (navigated) return;
      navigated = true;
      window.location.assign(thankYou.href);
    };
    if (typeof window.gtag === "function") {
      window.gtag("event", "generate_lead", {
        method: "contact_form",
        event_callback: navigate,
        event_timeout: 800,
      });
      setTimeout(navigate, 1000);
    } else {
      navigate();
    }
  });
}
