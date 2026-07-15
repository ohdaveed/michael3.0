import { test, expect } from "@playwright/test";
import productContract from "../../public/js/product-contract.json" with { type: "json" };

// The contact form is a third-party Tally iframe (tally.so/r/ob17lb). These
// tests never hit the real Tally service — submitting there would create
// real leads against Michael Lehr's live intake webhook on every test run.
// Instead we intercept the tally.so requests our own code makes (the widget
// script + the embed URL) and serve minimal stand-ins, keeping the iframe's
// origin as https://tally.so so postMessage origin checks in
// js/tally-embed.js still behave exactly as they do in production.

async function mockTally(page) {
  await page.route(
    /googletagmanager\.com|fonts\.(googleapis|gstatic)\.com/,
    (route) => route.abort(),
  );

  await page.route("https://tally.so/widgets/embed.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.Tally = { loadEmbeds() {
        document.querySelectorAll("iframe[data-tally-src]").forEach((iframe) => {
          if (!iframe.src) iframe.src = iframe.dataset.tallySrc;
        });
      } };`,
    }),
  );

  await page.route("https://tally.so/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body>mock tally form</body></html>",
    }),
  );
}

async function waitForTallyFrame(page) {
  await page.waitForFunction(() =>
    document.querySelector("iframe[data-tally-src]")?.getAttribute("src"),
  );
  const frame = page.frame({ url: /^https:\/\/tally\.so\/embed\// });
  expect(frame, "mocked Tally iframe should have loaded").toBeTruthy();
  return frame;
}

test.describe("Contact page — send a message", () => {
  test("embeds the Tally form with no service prefill by default", async ({
    page,
  }) => {
    await mockTally(page);
    await page.goto("/contact.html");

    const iframe = page.locator("iframe[data-tally-src]");
    await expect(iframe).toHaveAttribute("title", /send a message/i);
    const src = await iframe.getAttribute("data-tally-src");
    expect(src).not.toContain("service_label=");
  });

  test("translates a ?service= code into the form's service_label prefill", async ({
    page,
  }) => {
    const product = productContract.products.find(
      (p) => p.code === "TRUST_PACKAGE",
    );
    await mockTally(page);
    await page.goto("/contact.html?service=TRUST_PACKAGE");

    const iframe = page.locator("iframe[data-tally-src]");
    await expect(iframe).toHaveAttribute(
      "data-tally-src",
      new RegExp(
        `service_label=${encodeURIComponent(product.label).replace(/%20/g, "\\+")}`,
      ),
    );
  });

  test("noscript fallback links straight to the hosted Tally form", async ({
    page,
  }) => {
    await mockTally(page);
    await page.goto("/contact.html");
    const html = await page.content();
    expect(html).toContain(
      "https://tally.so/r/ob17lb?form_source=lehr-law-contact&contract_version=2&page=contact-noscript",
    );
  });

  test("submitting the form fires generate_lead and redirects to the thank-you page", async ({
    page,
  }) => {
    await mockTally(page);
    await page.goto("/contact.html");

    const frame = await waitForTallyFrame(page);

    // Simulate what the real Tally widget posts to its parent window on
    // successful submission — evaluated inside the tally.so-origin frame so
    // the event.origin check in js/tally-embed.js passes exactly as it
    // would for a real submission.
    await frame.evaluate(() => {
      window.parent.postMessage(
        JSON.stringify({ event: "Tally.FormSubmitted" }),
        "*",
      );
    });

    // Read dataLayer before the page navigates away (window.location.assign
    // tears down this document once the redirect fires).
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window.dataLayer || []).some((entry) => {
            const args = Array.from(entry);
            return (
              args[0] === "event" &&
              args[1] === "generate_lead" &&
              args[2]?.method === "contact_form"
            );
          }),
        ),
      )
      .toBe(true);

    // GA is blocked in this test, so event_callback never fires — the
    // ~1s fallback timeout in js/tally-embed.js must still redirect.
    await page.waitForURL(/\/thank-you\.html$/, { timeout: 3000 });
  });
});

test.describe("Thank-you page", () => {
  test("is reachable directly and excluded from indexing", async ({ page }) => {
    await page.route(
      /googletagmanager\.com|fonts\.(googleapis|gstatic)\.com/,
      (route) => route.abort(),
    );
    const response = await page.goto("/thank-you.html");
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Message Received/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, follow",
    );
  });
});
