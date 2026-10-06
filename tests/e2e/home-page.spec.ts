import { expect, test } from "@playwright/test";

test("home marketing page allows switching modes, parsing requests into chips, and continuing into the app", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tell it what you need." })).toBeVisible();

  // Test vendor toggle
  await page.getByRole("button", { name: "I'm a vendor" }).click();
  await expect(page.getByRole("heading", { name: "Get paid for what you deliver." })).toBeVisible();
  await expect(page.getByText("₦378,000")).toBeVisible();
  await expect(page.getByText("KORA · KTR-1P6W2D")).toBeVisible();

  // Switch back to buying
  await page.getByRole("button", { name: "I'm buying" }).click();
  await expect(page.getByRole("heading", { name: "Tell it what you need." })).toBeVisible();

  // Test trying an example
  await page.getByRole("button", { name: "120 lab coats for a class" }).click();
  await expect(page.getByText("Lab coats", { exact: true })).toBeVisible();
  await expect(page.getByText("120", { exact: true })).toBeVisible();
  await expect(page.getByText("₦1,100,000", { exact: true })).toBeVisible();

  // Continue in app
  await page.getByRole("link", { name: "Continue in the app →" }).click();
  await expect(page).toHaveURL(/\/buy\?text=/);
  await expect(page.locator("textarea")).toHaveValue(/120 lab coats/);
});
