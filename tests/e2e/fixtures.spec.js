import { test, expect } from "./fixtures.js";

test.describe("Shared third-party-blocking fixture", () => {
  test("aborts googletagmanager.com and Google Fonts requests automatically", async ({
    page,
  }) => {
    const failedHosts = [];
    page.on("requestfailed", (request) => {
      failedHosts.push(new URL(request.url()).hostname);
    });

    await page.goto("/index.html");
    // This spec asserts the third-party requests were blocked, so it has to
    // wait for the network to settle before inspecting the failed list.
    // eslint-disable-next-line playwright/no-networkidle
    await page.waitForLoadState("networkidle");

    expect(
      failedHosts.some((host) => host.includes("googletagmanager.com")),
    ).toBe(true);
    expect(
      failedHosts.some(
        (host) =>
          host.includes("fonts.googleapis.com") ||
          host.includes("fonts.gstatic.com"),
      ),
    ).toBe(true);
  });

  test("does not block same-origin requests", async ({ page }) => {
    const response = await page.goto("/index.html");
    expect(response.status()).toBe(200);
  });
});
