import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Real-browser end-to-end test for the double-booking UX:
 *  1. User A signs up, books a room for a specific time -> sees a confirmation.
 *  2. User B (separate browser context = separate session, separate account)
 *     signs up and tries to book the exact same resource/time -> sees the
 *     "Slot taken" notice, not a generic error and not any of User A's
 *     private details.
 *
 * This drives the real running app through the browser (Playwright), not
 * the API directly, and captures a screenshot of the conflict state.
 */

function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function signUp(page: Page, name: string, email: string, password: string) {
  await page.goto("/");
  await page.getByTestId("toggle-new-user").click();
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("email-input").fill(email);
  await page.getByTestId("password-input").fill(password);
  await page.getByTestId("confirm-password-input").fill(password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("current-user-name")).toHaveText(name);
}

test("second user sees Slot taken when booking an already-booked room/time", async ({ browser }) => {
  const date = tomorrowDateString();
  const startTime = "16:30";
  const endTime = "17:30";
  const unique = Date.now();

  // --- User A: signs up and books successfully ---
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await signUp(pageA, "Priya Sharma", `priya-${unique}@example.com`, "correcthorsebattery");

  await pageA.getByTestId("resource-card").first().getByRole("link", { name: /book this room/i }).click();
  await expect(pageA.getByTestId("resource-name")).toBeVisible();

  const resourceUrl = pageA.url();

  await pageA.getByTestId("date-input").fill(date);
  await pageA.getByTestId("start-input").fill(startTime);
  await pageA.getByTestId("end-input").fill(endTime);

  await expect(pageA.getByTestId("availability-badge")).toHaveText(/available/i, { timeout: 10_000 });

  await pageA.getByTestId("submit-booking").click();
  await expect(pageA.getByTestId("booking-confirmation")).toBeVisible();
  await expect(pageA.getByTestId("booking-confirmation")).toContainText("CONFIRMED");

  // --- User B: separate session/account, same resource + same time ---
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signUp(pageB, "Marcus Webb", `marcus-${unique}@example.com`, "correcthorsebattery");

  await pageB.goto(resourceUrl);

  await pageB.getByTestId("date-input").fill(date);
  await pageB.getByTestId("start-input").fill(startTime);
  await pageB.getByTestId("end-input").fill(endTime);

  await pageB.getByTestId("submit-booking").click();

  const slotTaken = pageB.getByTestId("slot-taken-notice");
  await expect(slotTaken).toBeVisible();
  await expect(slotTaken).toContainText("Slot taken");
  await expect(slotTaken).toContainText("no longer available for the selected time");

  // Must never leak User A's identity/details in the conflict UI.
  const bodyText = await pageB.locator("body").innerText();
  expect(bodyText).not.toMatch(/Priya/);
  expect(bodyText).not.toMatch(/@example\.com/);

  await expect(pageB.getByTestId("booking-confirmation")).toHaveCount(0);

  const screenshotPath = path.resolve(__dirname, "..", "..", "screenshots", "slot-taken.png");
  await pageB.screenshot({ path: screenshotPath, fullPage: true });

  await contextA.close();
  await contextB.close();
});
