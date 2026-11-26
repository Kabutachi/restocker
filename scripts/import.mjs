#!/usr/bin/env node
// One-time import of the "Resale Stock Check" artifact into D1 + R2.
//
//   node scripts/import.mjs --source <folder> --local  [--persist-to <dir>] [--force] [--dry-run]
//   node scripts/import.mjs --source <folder> --remote [--force] [--dry-run]
//
// <folder> holds the artifact's files as published: index.html, p/NN-K.jpg, t/NN.jpg.
// Photos are uploaded first, then items + photo rows are written in one SQL file,
// so an item never points at a photo that is not there.
// Refuses to run if the items table already has rows, unless --force (which deletes all items and photo rows).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const DB = "resale";
const BUCKET = "resale-photos";

// ---- args ----------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const source = opt("--source");
const local = flag("--local"), remote = flag("--remote");
const persistTo = opt("--persist-to");
const force = flag("--force"), dryRun = flag("--dry-run");
if (!source || local === remote) {
  console.error("Usage: node scripts/import.mjs --source <folder> (--local [--persist-to <dir>] | --remote) [--force] [--dry-run]");
  process.exit(2);
}
const target = local ? ["--local", ...(persistTo ? ["--persist-to", persistTo] : [])] : ["--remote"];

// ---- read ITEMS from the artifact page ------------------------------------------
const html = readFileSync(join(source, "index.html"), "utf8");
const line = html.split("\n").find((l) => l.startsWith("const ITEMS = "));
if (!line) throw new Error("const ITEMS = [...] not found in index.html");
const ITEMS = JSON.parse(line.slice("const ITEMS = ".length).replace(/;\s*$/, ""));
console.log(`Found ${ITEMS.length} items in the artifact.`);

const STATUSES = new Set(["to_list", "listed", "kept", "maybe_keep", "sold"]);
const problems = [];
const photos = []; // { id, itemId, key, thumbKey, position }
const uploads = new Map(); // r2 key -> local file

for (const it of ITEMS) {
  if (!Number.isInteger(it.id) || it.id < 1) problems.push(`bad id: ${JSON.stringify(it.id)}`);
  if (!STATUSES.has(it.status)) problems.push(`#${it.id}: unknown status ${it.status}`);
  if (!["now", "spring"].includes(it.when)) problems.push(`#${it.id}: unknown season ${it.when}`);
  (it.photos || []).forEach((p, k) => {
    const file = join(source, p);
    if (!existsSync(file)) return problems.push(`#${it.id}: missing ${p}`);
    const key = `items/${it.id}/${basename(p)}`;
    uploads.set(key, file);
    let thumbKey = key; // only one thumbnail per item exists in the artifact: use it for the first photo
    if (k === 0 && it.thumb && existsSync(join(source, it.thumb))) {
      thumbKey = `items/${it.id}/${basename(it.thumb, ".jpg")}-t.jpg`;
      uploads.set(thumbKey, join(source, it.thumb));
    }
    photos.push({ id: `imp-${it.id}-${k + 1}`, itemId: it.id, key, thumbKey, position: k });
  });
}
if (problems.length) {
  console.error("Stopped, the source has problems:\n  " + problems.join("\n  "));
  process.exit(1);
}

// ---- SQL ------------------------------------------------------------------------
const q = (v) => (v === null || v === undefined || v === "" ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const sql = [];
if (force) sql.push("DELETE FROM photos;", "DELETE FROM items;");
for (const it of ITEMS) {
  const row = {
    id: it.id, name: it.name, brand: it.brand, size: it.size, where_sell: it.where, season: it.when,
    note: it.note, owner_note: it.owner, vinted_text: it.de, list_price: it.list, min_price: it.min,
    status: it.status, interest: "none", type: it.type, colors_json: JSON.stringify(it.colors || []),
    tags_json: JSON.stringify(it.tags || []), pieces: it.pieces || 1,
  };
  sql.push(`INSERT INTO items (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")});`);
}
for (const p of photos)
  sql.push(`INSERT INTO photos (id, item_id, r2_key, thumb_key, position) VALUES (${[p.id, p.itemId, p.key, p.thumbKey, p.position].map(q).join(", ")});`);

const work = mkdtempSync(join(tmpdir(), "resale-import-"));
const sqlFile = join(work, "import.sql");
const manifest = join(work, "photos.json");
writeFileSync(sqlFile, sql.join("\n") + "\n");
writeFileSync(manifest, JSON.stringify([...uploads].map(([key, file]) => ({ key, file: resolve(file) }))));
console.log(`Prepared ${ITEMS.length} items, ${photos.length} photo rows, ${uploads.size} files to upload.`);
console.log(`SQL: ${sqlFile}\nR2 manifest: ${manifest}`);
if (dryRun) process.exit(0);

// ---- run wrangler ---------------------------------------------------------------
const wranglerJs = resolve("node_modules/wrangler/bin/wrangler.js");
function wrangler(args, { capture = false } = {}) {
  const r = spawnSync(process.execPath, [wranglerJs, ...args], { stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`wrangler ${args.slice(0, 3).join(" ")} … failed (exit ${r.status}).`);
    process.exit(1);
  }
  return r.stdout;
}

const out = wrangler(["d1", "execute", DB, ...target, "--json", "--command", "SELECT COUNT(*) AS n FROM items"], { capture: true });
const existing = JSON.parse(out)[0].results[0].n;
if (existing > 0 && !force) {
  console.error(`The ${remote ? "remote" : "local"} database already has ${existing} items. Nothing was changed.\nRe-run with --force to replace them (deletes all items and photo rows).`);
  process.exit(1);
}

console.log(`\nUploading ${uploads.size} photos to R2 (${remote ? "remote" : "local"})…`);
wrangler(["r2", "bulk", "put", BUCKET, ...target, "--filename", manifest, "--content-type", "image/jpeg", "--cache-control", "private, max-age=31536000, immutable"]);

console.log(`\nWriting items to D1 (${remote ? "remote" : "local"})…`);
wrangler(["d1", "execute", DB, ...target, ...(remote ? ["--yes"] : []), "--file", sqlFile]);

const check = JSON.parse(wrangler(["d1", "execute", DB, ...target, "--json", "--command",
  "SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM photos) AS photos"], { capture: true }))[0].results[0];
console.log(`\nDone: ${check.items} items, ${check.photos} photos in the database.`);
