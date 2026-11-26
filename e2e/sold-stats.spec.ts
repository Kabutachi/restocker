import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createSold, dateMonthsAgo, lastMonths, monthKey, resetDb, seedBase } from "./helpers/seed";

/*
 * Test-id contract for the Sold stats view (dev must provide these):
 *   #soldview                            the section
 *   [data-testid="metric-<key>"]         one per card; keys: sold, revenue, profit, avg, sellthrough, salevslist,
 *                                        no-price, no-date. The card text contains label and formatted value.
 *   [data-testid="chart-month"]          "Revenue per month" chart; each bar has [data-month="YYYY-MM"][data-value="<number>"]
 *   [data-testid="chart-type"]           "Revenue by type" chart; each bar has [data-label="<label>"][data-value="<number>"],
 *                                        DOM order = display order
 *   Empty state: text "No sales yet" inside #soldview, and no chart-month / chart-type elements.
 */

let api: APIRequestContext;
test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL, storageState: "e2e/.auth/state.json" });
});
test.afterAll(async () => api.dispose());

const metric = (page: Page, key: string) => page.getByTestId(`metric-${key}`);
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function openSold(page: Page) {
  await page.goto("/#/sold");
  await expect(page.locator("#soldview")).toBeVisible();
}

test.describe("with base fixture", () => {
  test.beforeAll(async () => {
    resetDb();
    await seedBase(api);
  });

  test("AC-4: metric cards show exact values", async ({ page }) => {
    await openSold(page);
    await expect(metric(page, "sold")).toContainText("3");
    await expect(metric(page, "revenue")).toContainText("€100");
    await expect(metric(page, "profit")).toContainText("€40");
    await expect(metric(page, "profit")).toContainText("2 with cost");
    await expect(metric(page, "avg")).toContainText(/€33[.,]33/);
    await expect(metric(page, "sellthrough")).toContainText("60%");
    await expect(metric(page, "salevslist")).toContainText("80%");
  });

  test("AC-5: revenue per month has 12 bars with the right values", async ({ page }) => {
    await openSold(page);
    const chart = page.getByTestId("chart-month");
    const bars = chart.locator("[data-month]");
    await expect(bars).toHaveCount(12);
    const rows = (await bars.evaluateAll((els) =>
      els.map((e) => [e.getAttribute("data-month"), Number(e.getAttribute("data-value"))]),
    )) as [string, number][];
    expect(rows.map((r) => r[0])).toEqual(lastMonths(12));
    const byMonth = Object.fromEntries(rows);
    expect(byMonth[monthKey(0)]).toBe(70);
    expect(byMonth[monthKey(2)]).toBe(30);
    for (const [m, v] of rows) if (m !== monthKey(0) && m !== monthKey(2)) expect(v).toBe(0);
    // The value is also readable as text (visible label or <title>).
    await expect(chart).toContainText("€70");
    await expect(chart).toContainText("€30");
  });

  test("AC-6: revenue by type is sorted descending with display labels", async ({ page }) => {
    await openSold(page);
    const bars = page.getByTestId("chart-type").locator("[data-label]");
    const rows = (await bars.evaluateAll((els) =>
      els.map((e) => [e.getAttribute("data-label"), Number(e.getAttribute("data-value"))]),
    )) as [string, number][];
    // jacket 40, then shoes 30 and untyped 30 (tie: either order)
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["Jackets & coats", 40]);
    expect(rows.slice(1).map((r) => r[0]).sort()).toEqual(["Shoes", "Untyped"]);
    expect(rows.slice(1).map((r) => r[1])).toEqual([30, 30]);
  });

  test("AC-10: stats follow a sale and an undo without reloading", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#grid")).toBeVisible();
    await page.locator("#grid").getByText("Todo item").first().click();
    await page.getByRole("button", { name: "Sold…" }).click();
    await page.locator("#s-price").fill("25");
    await page.locator("#sellform").evaluate((f) => (f as HTMLFormElement).requestSubmit());
    await expect(page.locator("#selldlg")).toBeHidden();
    await page.keyboard.press("Escape"); // close the item dialog if still open
    await nav(page).getByRole("link", { name: "Sold stats" }).click();
    await expect(metric(page, "sold")).toContainText("4");
    await expect(metric(page, "revenue")).toContainText("€125");

    await nav(page).getByRole("link", { name: "Catalogue" }).click();
    await page.locator("#grid").getByText("Todo item").first().click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Undo sale" }).click();
    await page.keyboard.press("Escape");
    await nav(page).getByRole("link", { name: "Sold stats" }).click();
    await expect(metric(page, "sold")).toContainText("3");
    await expect(metric(page, "revenue")).toContainText("€100");
  });

  test("AC-11: no CSP violations, no external assets, no inline script", async ({ page, baseURL }) => {
    const problems: string[] = [];
    const external: string[] = [];
    page.on("console", (m) => {
      if (/content security policy/i.test(m.text())) problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith("http") && u.origin !== new URL(baseURL!).origin) external.push(r.url());
    });
    await openSold(page);
    await expect(page.getByTestId("chart-month")).toBeVisible();
    await expect(page.getByTestId("chart-type")).toBeVisible();
    expect(problems).toEqual([]);
    expect(external.filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual([]);
    expect(await page.locator("script:not([src])").count()).toBe(0);
  });
});

test.describe("data-quality fixture", () => {
  test.beforeAll(async () => {
    resetDb();
    await seedBase(api);
    await createSold(api, { name: "No price", list_price: 10 }, { sell_price: null, sold_at: dateMonthsAgo(1, 5) });
    await createSold(api, { name: "No date", type: "shoes", buy_price: 1 }, { sell_price: 20, sold_at: null });
  });

  test("AC-7: counts items missing price/date; undated item is left out of the monthly chart", async ({ page }) => {
    await openSold(page);
    await expect(metric(page, "no-price")).toContainText("Sold without price");
    await expect(metric(page, "no-price")).toContainText("1");
    await expect(metric(page, "no-date")).toContainText("Sold without date");
    await expect(metric(page, "no-date")).toContainText("1");
    await expect(metric(page, "sold")).toContainText("5");
    const bars = page.getByTestId("chart-month").locator("[data-month]");
    const total = await bars.evaluateAll((els) => els.reduce((s, e) => s + Number(e.getAttribute("data-value")), 0));
    expect(total).toBe(100); // the undated item's EUR 20 is in no month
  });
});

test.describe("empty database", () => {
  test.beforeAll(() => resetDb());

  test("AC-8: shows 'No sales yet', no chart, no JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openSold(page);
    await expect(page.locator("#soldview")).toContainText("No sales yet");
    await expect(page.getByTestId("chart-month")).toHaveCount(0);
    await expect(page.getByTestId("chart-type")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
