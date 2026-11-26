import { test, expect } from "@playwright/test";
import { resetDb, seedBase } from "./helpers/seed";

test.beforeAll(async ({ playwright, baseURL }) => {
  resetDb();
  const api = await playwright.request.newContext({ baseURL, storageState: "e2e/.auth/state.json" });
  await seedBase(api);
  await api.dispose();
});

test("AC-1: nav landmark lists Catalogue and Sold stats, Catalogue is current", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Catalogue" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Sold stats" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Sold stats" })).not.toHaveAttribute("aria-current", "page");
});

test("AC-2: clicking Sold stats shows the stats view and hides the catalogue", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#grid")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Sold stats" }).click();
  await expect(page).toHaveURL(/#\/sold$/);
  await expect(page.locator("#soldview")).toBeVisible();
  await expect(page.locator("#grid")).toBeHidden();
  await expect(page.locator("#g-st")).toBeHidden();
  await expect(page.locator("#q")).toBeHidden();
  await expect(nav.getByRole("link", { name: "Sold stats" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Catalogue" })).not.toHaveAttribute("aria-current", "page");
});

test("AC-3: deep link, reload and Back work", async ({ page }) => {
  await page.goto("/#/sold");
  await expect(page.locator("#soldview")).toBeVisible();
  await expect(page.locator("#grid")).toBeHidden();
  await page.reload();
  await expect(page.locator("#soldview")).toBeVisible();
  await expect(page.locator("#grid")).toBeHidden();

  // Catalogue -> Sold stats -> Back returns to the catalogue.
  await page.goto("/#/");
  await expect(page.locator("#grid")).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sold stats" }).click();
  await expect(page.locator("#soldview")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#grid")).toBeVisible();
  await expect(page.locator("#soldview")).toBeHidden();
});

test("AC-9: on a phone the nav sits behind a Menu button", async ({ browser }) => {
  const ctx = await browser.newContext({
    baseURL: "http://localhost:8799",
    viewport: { width: 390, height: 844 },
    storageState: "e2e/.auth/state.json",
  });
  const page = await ctx.newPage();
  await page.goto("/");
  const soldLink = page.getByRole("link", { name: "Sold stats" });
  const catLink = page.getByRole("link", { name: "Catalogue" });
  await expect(soldLink).toBeHidden();
  await expect(catLink).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(soldLink).toBeVisible();
  await expect(catLink).toBeVisible();
  await soldLink.click();
  await expect(page.locator("#soldview")).toBeVisible();
  await expect(soldLink).toBeHidden();
  await ctx.close();
});
