import { test, expect } from "./fixtures.js";

test.describe("Guided process tour", () => {
  test("launches, advances, and can be closed", async ({ page }) => {
    await page.goto("/process.html");

    await page.locator("#start-tour-btn").click();

    const popoverTitle = page.locator(".driver-popover-title");
    await expect(popoverTitle).toHaveText("Welcome to the Guided Tour!");

    await page.locator(".driver-popover-next-btn").click();
    await expect(popoverTitle).toHaveText("Step 1: Free Consultation");

    await page.locator(".driver-popover-close-btn").click();
    await expect(page.locator(".driver-popover")).toHaveCount(0);
  });
});
