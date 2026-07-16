import { test as base, expect } from "@playwright/test";

// Auto-applied (no need to reference it in test args) to every test that
// imports `test` from this file. Blocks GA's external script and Google
// Fonts so specs never depend on, or send real traffic to, third-party
// services — the same blocking send-a-message.spec.js does inline, moved
// here once so the other 8 spec files don't repeat it.
export const test = base.extend({
  blockThirdParty: [
    async ({ page }, use) => {
      await page.route(
        /googletagmanager\.com|fonts\.(googleapis|gstatic)\.com/,
        (route) => route.abort(),
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect };
