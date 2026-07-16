import { test, expect } from "./fixtures.js";

test.describe("Trust funding checklist", () => {
  test("updates progress as items are checked", async ({ page }) => {
    await page.goto("/services.html");

    await expect(page.locator("#fundingProgressLabel")).toHaveText(
      "0 of 6 assets retitled",
    );
    await expect(page.locator("#fundingProgress")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    await page.locator('[data-funding-id="home"]').check();

    await expect(page.locator("#fundingProgressLabel")).toHaveText(
      "1 of 6 assets retitled",
    );
    await expect(page.locator("#fundingProgress")).toHaveAttribute(
      "aria-valuenow",
      "17",
    );
  });

  test("persists checked state across a reload", async ({ page }) => {
    await page.goto("/services.html");

    await page.locator('[data-funding-id="home"]').check();
    await page.locator('[data-funding-id="bank"]').check();
    await expect(page.locator("#fundingProgressLabel")).toHaveText(
      "2 of 6 assets retitled",
    );

    await page.reload();

    await expect(page.locator('[data-funding-id="home"]')).toBeChecked();
    await expect(page.locator('[data-funding-id="bank"]')).toBeChecked();
    await expect(
      page.locator('[data-funding-id="brokerage"]'),
    ).not.toBeChecked();
    await expect(page.locator("#fundingProgressLabel")).toHaveText(
      "2 of 6 assets retitled",
    );
  });
});
