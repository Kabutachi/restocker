import type { APIRequestContext } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { PERSIST } from "../../playwright.config";

/** Delete every item (and photos) in the local test database. */
export function resetDb() {
  const r = spawnSync(
    `npx wrangler d1 execute resale --local --persist-to "${PERSIST}" --command "DELETE FROM photos; DELETE FROM items;"`,
    { shell: true, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error("DB reset failed: " + r.stdout + r.stderr);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Date in the month `back` months ago, on day `day` (<= 28, so no month-end rollover). Local time. */
export function dateMonthsAgo(back: number, day = 15): string {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() - back, 1);
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(day)}`;
}
export const monthKey = (back: number) => dateMonthsAgo(back).slice(0, 7);

/** The last n calendar months as YYYY-MM, oldest first, current month last. */
export function lastMonths(n = 12): string[] {
  return Array.from({ length: n }, (_, i) => monthKey(n - 1 - i));
}

type Item = Record<string, unknown>;

export async function createItem(api: APIRequestContext, fields: Item): Promise<Item> {
  const res = await api.post("/api/items", { data: fields });
  if (!res.ok()) throw new Error("create failed: " + (await res.text()));
  return res.json();
}

export async function createSold(
  api: APIRequestContext,
  fields: Item,
  sale: { sell_price: number | null; sold_at: string | null },
): Promise<Item> {
  const item = await createItem(api, fields);
  const res = await api.post(`/api/items/${item.id}/sell`, { data: sale });
  if (!res.ok()) throw new Error("sell failed: " + (await res.text()));
  if (sale.sold_at === null) {
    // /sell defaults sold_at to today; clear it to simulate an undated sale.
    const p = await api.patch(`/api/items/${item.id}`, { data: { sold_at: null } });
    if (!p.ok()) throw new Error("patch failed: " + (await p.text()));
    return p.json();
  }
  return res.json();
}

/**
 * Fixture from the ticket:
 *  A jacket   sold 40, buy 10, list 50, this month
 *  B shoes    sold 30, buy 20, list 40, this month
 *  C untyped  sold 30, no buy, list 35, 2 months ago
 *  plus one to_list, one listed, one kept (kept is excluded from sell-through).
 */
export async function seedBase(api: APIRequestContext) {
  await createSold(api, { name: "Item A", type: "jacket", buy_price: 10, list_price: 50 }, { sell_price: 40, sold_at: dateMonthsAgo(0, 10) });
  await createSold(api, { name: "Item B", type: "shoes", buy_price: 20, list_price: 40 }, { sell_price: 30, sold_at: dateMonthsAgo(0, 11) });
  await createSold(api, { name: "Item C", list_price: 35 }, { sell_price: 30, sold_at: dateMonthsAgo(2, 15) });
  await createItem(api, { name: "Todo item", status: "to_list" });
  await createItem(api, { name: "Listed item", status: "listed", list_price: 20 });
  await createItem(api, { name: "Kept item", status: "kept" });
}
