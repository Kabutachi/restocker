# Restocker

A small, password-protected catalogue for second-hand items being resold (Vinted, willhaben, eBay). The owner edits everything in the browser: photos, texts, the Vinted listing text, buyer interest, purchase and sale prices, and marks items as sold.

Runs on Cloudflare's free tier: one Worker serves the page and the API, D1 stores the data and R2 stores the photos.

## Features

- **Catalogue:** photo grid with search, sorting and filters (status, buyer interest, season, material, type, colour, theme). Header totals: items for sale, list and minimum price, sold, revenue, profit.
- **Editing with approval:** every field can be edited in the item window. **Save…** shows a "was → now" list of only the changed fields, and nothing is written until **Approve**. If the item was saved on another device in the meantime, the save is refused and the latest version is shown.
- **Sold:** price, date (today by default) and buyer interest. The card turns grey and appears under the *Sold* filter. **Undo sale** restores the previous status.
- **Prices:** list, minimum, bought-for and sold-for prices. Profit is worked out automatically.
- **Vinted text:** one text box with a **Copy** button.
- **Photos:** resized in the browser before upload (1600 px plus a 480 px thumbnail, WebP or JPEG), then stored in R2. They can be reordered and deleted.
- **Phone layout:** two cards per row; the header scrolls away on small screens.

## Stack

| Part | Technology |
|---|---|
| Frontend | Plain HTML, CSS and JavaScript, no build step (`public/`) |
| Backend | Cloudflare Worker, TypeScript and [Hono](https://hono.dev) (`src/`) |
| Data | Cloudflare D1 (SQLite): items and photo rows (`migrations/`) |
| Photos | Cloudflare R2 bucket |
| Deploy | Wrangler |

## Security model

- **One shared password,** stored only as a Worker secret (`SITE_PASSWORD`), never in the repository. The Worker refuses to serve anything if the secret is missing or shorter than 12 characters.
- **Login:** the password check takes the same time whether it is right or wrong. Logins are capped at 5 per minute per IP address (Cloudflare rate limiting), and each wrong guess is delayed.
- **Session:** after login the browser gets a signed `HttpOnly; Secure; SameSite=Lax` cookie valid for 180 days. Changing the password logs every device out.
- **Everything is behind the login:** the item data, the API and the photos. Only the login page, its script, the stylesheet and the icon are public.
- **Writes from other sites are blocked:** the SameSite cookie plus an `Origin` check on every non-GET request.
- **Headers:** Content-Security-Policy (scripts only from this site), HSTS, `nosniff`, no framing, `noindex`, `no-store` on API responses.
- **Input checks:** all fields are validated against an allow-list on the server. Uploads must be JPEG or WebP, at most 8 MB each.

## Project layout

| Path | Contents |
|---|---|
| `src/index.ts` | Worker: login, item API, sale/undo, photo upload, `/img/*` |
| `src/auth.ts` | Password check and signed session cookie |
| `src/items.ts` | Editable fields and their validation |
| `migrations/0001_init.sql` | D1 schema |
| `public/` | Frontend: `index.html`, `app.js`, `style.css`, `login.html` |
| `scripts/import.mjs` | One-time import from the original catalogue |
| `wrangler.jsonc` | Worker `restocker`, D1 `resale`, R2 `resale-photos`, login rate limit |

## Run locally

Requires Node.js 20 or newer.

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars    # local test password, git-ignored
npm run db:migrate:local
npm run dev                              # http://localhost:8787
```

On Windows, local D1 fails with `internal error` when the project path is long (260-character limit). Keep the project in a short path, or add `--persist-to "$env:TEMP\rs-state"` to `wrangler dev` and `wrangler d1 …` commands.

## Deploy to Cloudflare

Run from the computer of the Cloudflare account owner. The password is typed only into the `wrangler secret put` prompt, never into a file or chat.

```powershell
npm install
npx wrangler login
npx wrangler d1 create resale              # paste the printed id into wrangler.jsonc → database_id
npx wrangler r2 bucket create resale-photos
npx wrangler secret put SITE_PASSWORD      # at least 12 characters
npm run db:migrate:remote
npm run deploy                             # prints https://restocker.<account>.workers.dev
```

R2 must be enabled in the Cloudflare dashboard first; this may ask for a payment card even on the free tier.

Free-tier limits are shared with any other site on the same account: Workers 100,000 requests per day, D1 5 GB, R2 10 GB. This project uses a fraction of that (about 40 MB of photos).

## Import the original catalogue (once)

`scripts/import.mjs` reads a folder with the original catalogue's files (`index.html`, `p/NN-K.jpg`, `t/NN.jpg`). It uploads the photos to R2 first, then writes items and photo rows to D1, so no item points at a missing photo. These files are not in the repository; put them in `import/data/artifact/` (git-ignored).

```powershell
node scripts/import.mjs --source import/data/artifact --remote --dry-run   # check only
node scripts/import.mjs --source import/data/artifact --remote
```

- If the database already has items, nothing is changed. `--force` deletes all items and photo rows and imports again, which also erases any edits made since.
- The original has one thumbnail per item. It is used for the first photo; other photos use the full image as their thumbnail.
- Use `--local` instead of `--remote` to import into the local dev database.

## Changing the password or logging everyone out

```powershell
npx wrangler secret put SITE_PASSWORD
```

The new password takes effect immediately, and every existing session stops working.
