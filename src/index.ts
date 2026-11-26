import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { COOKIE_NAME, SESSION_SECONDS, makeToken, passwordMatches, tokenValid } from "./auth";
import { cleanFields, toItem } from "./items";

type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  SITE_PASSWORD: string;
  LOGIN_LIMIT?: RateLimit; // optional: without it, logins are only slowed down, not capped
};

const app = new Hono<{ Bindings: Env }>();

// Paths reachable without logging in.
// The asset server serves login.html at /login (it redirects /login.html there).
const PUBLIC = new Set(["/login", "/login.html", "/login.js", "/style.css", "/api/login", "/favicon.svg"]);
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp" };
const MIN_PASSWORD_LENGTH = 12;

// Scripts and styles only from this site (+ Google Fonts); no framing, no inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'", // inline style attributes for colour swatches
  "font-src https://fonts.gstatic.com",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.use("*", async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("Content-Security-Policy", CSP);
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("X-Robots-Tag", "noindex, nofollow");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (new URL(c.req.url).pathname.startsWith("/api/")) h.set("Cache-Control", "no-store");
});

/** The site refuses to work with a missing or weak password rather than run unprotected. */
function passwordProblem(env: Env): string | null {
  if (!env.SITE_PASSWORD) return "SITE_PASSWORD secret is not set.";
  if (env.SITE_PASSWORD.length < MIN_PASSWORD_LENGTH)
    return `SITE_PASSWORD is too short: use at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

// ---- cross-site write protection ----------------------------------------------
// The cookie is SameSite=Lax already; this also rejects writes whose Origin is another site.
app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Cross-site request blocked" }, 403);
  return next();
});

// ---- auth gate ---------------------------------------------------------------
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC.has(path)) return next();
  const problem = passwordProblem(c.env);
  if (problem) return c.text(problem, 500);
  if (await tokenValid(c.env.SITE_PASSWORD, getCookie(c, COOKIE_NAME))) return next();
  if (path.startsWith("/api/") || path.startsWith("/img/")) return c.json({ error: "Not logged in" }, 401);
  return c.redirect("/login");
});

app.post("/api/login", async (c) => {
  const problem = passwordProblem(c.env);
  if (problem) return c.json({ error: problem }, 500);
  if (c.env.LOGIN_LIMIT) {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await c.env.LOGIN_LIMIT.limit({ key: "login:" + ip });
    if (!success) return c.json({ error: "Too many attempts. Wait a minute and try again." }, 429);
  }
  const body = await c.req.json<{ password?: unknown }>().catch(() => ({}) as { password?: unknown });
  const given = typeof body.password === "string" ? body.password : "";
  if (!(await passwordMatches(given, c.env.SITE_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing a little
    return c.json({ error: "Wrong password" }, 401);
  }
  setCookie(c, COOKIE_NAME, await makeToken(c.env.SITE_PASSWORD), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/", secure: true });
  return c.json({ ok: true });
});

// ---- items -------------------------------------------------------------------
async function loadItem(db: D1Database, id: number) {
  const row = await db.prepare("SELECT * FROM items WHERE id = ?").bind(id).first();
  if (!row) return null;
  const { results } = await db
    .prepare("SELECT * FROM photos WHERE item_id = ? ORDER BY position, created_at")
    .bind(id)
    .all();
  return toItem(row, results);
}

function itemId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

app.get("/api/items", async (c) => {
  const [items, photos] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM items ORDER BY id"),
    c.env.DB.prepare("SELECT * FROM photos ORDER BY item_id, position, created_at"),
  ]);
  const byItem = new Map<unknown, Record<string, unknown>[]>();
  for (const p of photos.results as Record<string, unknown>[]) {
    const list = byItem.get(p.item_id) ?? [];
    list.push(p);
    byItem.set(p.item_id, list);
  }
  return c.json((items.results as Record<string, unknown>[]).map((r) => toItem(r, byItem.get(r.id) ?? [])));
});

app.get("/api/items/:id", async (c) => {
  const id = itemId(c.req.param("id"));
  const item = id && (await loadItem(c.env.DB, id));
  return item ? c.json(item) : c.json({ error: "Not found" }, 404);
});

app.post("/api/items", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const clean = cleanFields({ name: "New item", ...body });
  if (typeof clean === "string") return c.json({ error: clean }, 400);
  const next = await c.env.DB.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM items").first<{ id: number }>();
  const id = next!.id;
  const cols = ["id", ...clean.cols];
  await c.env.DB.prepare(`INSERT INTO items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .bind(id, ...clean.vals)
    .run();
  return c.json(await loadItem(c.env.DB, id), 201);
});

// Save edited fields. The client sends `base_updated_at` (the version it edited);
// if someone saved in between, nothing is written and 409 is returned.
app.patch("/api/items/:id", async (c) => {
  const id = itemId(c.req.param("id"));
  if (!id) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: "Expected JSON" }, 400);
  const clean = cleanFields(body);
  if (typeof clean === "string") return c.json({ error: clean }, 400);
  if (!clean.cols.length) return c.json({ error: "Nothing to change" }, 400);

  const set = clean.cols.map((col) => `${col} = ?`).join(", ");
  let sql = `UPDATE items SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`;
  const args: (string | number | null)[] = [...clean.vals, id];
  if (typeof body.base_updated_at === "string") {
    sql += " AND updated_at = ?";
    args.push(body.base_updated_at);
  }
  const res = await c.env.DB.prepare(sql).bind(...args).run();
  if (!res.meta.changes) {
    const current = await loadItem(c.env.DB, id);
    if (!current) return c.json({ error: "Not found" }, 404);
    return c.json({ error: "This item was changed on another device. Reload to see the latest.", current }, 409);
  }
  return c.json(await loadItem(c.env.DB, id));
});

app.post("/api/items/:id/sell", async (c) => {
  const id = itemId(c.req.param("id"));
  if (!id) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const clean = cleanFields({
    interest: body.interest ?? "none",
    sold_at: body.sold_at ?? new Date().toISOString().slice(0, 10),
    sell_price: body.sell_price ?? null,
  });
  if (typeof clean === "string") return c.json({ error: clean }, 400);
  const [interest, soldAt, sellPrice] = clean.vals;
  const res = await c.env.DB.prepare(
    `UPDATE items SET
       prev_status = CASE WHEN status = 'sold' THEN prev_status ELSE status END,
       status = 'sold', interest = ?, sold_at = ?, sell_price = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  )
    .bind(interest, soldAt, sellPrice, id)
    .run();
  if (!res.meta.changes) return c.json({ error: "Not found" }, 404);
  return c.json(await loadItem(c.env.DB, id));
});

app.post("/api/items/:id/unsell", async (c) => {
  const id = itemId(c.req.param("id"));
  if (!id) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare(
    `UPDATE items SET status = COALESCE(prev_status, 'to_list'), prev_status = NULL,
       sold_at = NULL, sell_price = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND status = 'sold'`,
  )
    .bind(id)
    .run();
  const item = await loadItem(c.env.DB, id);
  return item ? c.json(item) : c.json({ error: "Not found" }, 404);
});

// ---- photos ------------------------------------------------------------------
// The browser resizes photos before upload (full ~1600px + thumbnail), so the Worker only stores them.
app.post("/api/items/:id/photos", async (c) => {
  const id = itemId(c.req.param("id"));
  if (!id) return c.json({ error: "Not found" }, 404);
  const exists = await c.env.DB.prepare("SELECT 1 FROM items WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "Not found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const full = form?.get("full");
  const thumb = form?.get("thumb");
  if (!(full instanceof File) || !(thumb instanceof File)) return c.json({ error: "Expected full and thumb files" }, 400);
  for (const f of [full, thumb]) {
    if (!IMAGE_TYPES[f.type]) return c.json({ error: "Photos must be JPEG or WebP" }, 400);
    if (f.size > MAX_PHOTO_BYTES) return c.json({ error: "Photo is too large" }, 400);
  }

  const pid = crypto.randomUUID();
  const fullKey = `items/${id}/${pid}.${IMAGE_TYPES[full.type]}`;
  const thumbKey = `items/${id}/${pid}-t.${IMAGE_TYPES[thumb.type]}`;
  await Promise.all([
    c.env.PHOTOS.put(fullKey, full.stream(), { httpMetadata: { contentType: full.type } }),
    c.env.PHOTOS.put(thumbKey, thumb.stream(), { httpMetadata: { contentType: thumb.type } }),
  ]);
  await c.env.DB.prepare(
    `INSERT INTO photos (id, item_id, r2_key, thumb_key, position)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM photos WHERE item_id = ?))`,
  )
    .bind(pid, id, fullKey, thumbKey, id)
    .run();
  return c.json(await loadItem(c.env.DB, id), 201);
});

app.put("/api/items/:id/photo-order", async (c) => {
  const id = itemId(c.req.param("id"));
  if (!id) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return c.json({ error: "Expected ids" }, 400);
  if (ids.length)
    await c.env.DB.batch(
      ids.map((pid, i) =>
        c.env.DB.prepare("UPDATE photos SET position = ? WHERE id = ? AND item_id = ?").bind(i, pid, id),
      ),
    );
  return c.json(await loadItem(c.env.DB, id));
});

app.delete("/api/photos/:pid", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM photos WHERE id = ?")
    .bind(c.req.param("pid"))
    .first<{ id: string; item_id: number; r2_key: string; thumb_key: string }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  await c.env.PHOTOS.delete([row.r2_key, row.thumb_key]);
  await c.env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(row.id).run();
  return c.json(await loadItem(c.env.DB, row.item_id));
});

// Photo files, only for logged-in browsers. Keys are unique per upload, so they can be cached forever.
app.get("/img/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/img/".length));
  if (!key.startsWith("items/") || key.includes("..")) return c.notFound();
  const obj = await c.env.PHOTOS.get(key, { onlyIf: c.req.raw.headers });
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
});

// ---- static frontend ---------------------------------------------------------
// Asset responses have immutable headers; copy so the security-header middleware can add to them.
app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
});

export default app;
