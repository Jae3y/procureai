import { expect, test } from "@playwright/test";

/**
 * The full purchase in a real browser: quotes → Kora checks → approve → pay → tracker →
 * vendor enters the code on a phone → complete → record. Also: the vendor that failed
 * verification can never be approved.
 */
test("buyer and vendor complete a purchase; every naira is accounted for", async ({ page, browser }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Three replies. One format." })).toBeVisible();

  await page.getByRole("button", { name: "Check vendors with Kora" }).click();
  await expect(page.getByRole("heading", { name: "Vendor B." })).toBeVisible({ timeout: 90_000 });

  // The failed-verification vendor is shown struck through, with Kora's reason, and is not approvable.
  await expect(page.getByText("✕ Company registration could not be verified.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve Vendor A/ })).toHaveCount(0);
  await expect(page.getByText("Payout account belongs to a registered director.")).toBeVisible();

  await page.getByRole("button", { name: "Approve Vendor B" }).click();
  await expect(page).toHaveURL(/\/orders\//, { timeout: 90_000 });
  await expect(page.getByText("Pay into this account")).toBeVisible();

  // Pay through the sandbox (real Kora sandbox credit, or the test double offline).
  await page.getByRole("button", { name: /^Transfer ₦1,260,000$/ }).click();
  await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Open tracker" }).click();
  await expect(page.getByRole("heading", { name: "Stage 1 paid. Waiting for delivery." })).toBeVisible({ timeout: 90_000 });
  const code = (await page.locator(".code-big").innerText()).replace(/\s/g, "");
  expect(code).toMatch(/^\d{6}$/);

  // The vendor's phone, from the admin's invite link.
  const admin = await browser.newPage();
  await admin.goto("/admin");
  const link = await admin.getByRole("row", { name: /Vendor B/ }).getByRole("link").getAttribute("href");
  expect(link).toBeTruthy();
  await admin.close();

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  await phone.goto(link ?? "");
  await expect(phone.getByText("is in your account.")).toBeVisible({ timeout: 60_000 });
  await phone.getByLabel("Delivery code, 6 digits").fill(code);
  await phone.getByRole("button", { name: "Confirm delivery" }).click();
  await expect(phone.getByText("Paid", { exact: true })).toBeVisible({ timeout: 90_000 });
  await phoneCtx.close();

  // The laptop updates live.
  await expect(page.getByRole("heading", { name: "Complete. Every naira accounted for." })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Open record" }).click();
  await expect(page.getByText("Left unaccounted")).toBeVisible();
  await expect(page.locator(".money-total")).toContainText("₦0");
  await expect(page.getByText(/COMPLETE · ALL REFERENCES (SIGNED BY|CONFIRMED WITH) KORA/)).toBeVisible();
});
