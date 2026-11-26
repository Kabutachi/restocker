"use strict";
// Resale Stock — catalog + editor. Plain JS, no build step.

// ---- vocabularies (from the original artifact) ---------------------------------
const STATUS = [["to_list", "For sale"], ["listed", "Listed"], ["kept", "Keeping"], ["maybe_keep", "Maybe keep"], ["sold", "Sold"]];
const INTEREST = [["none", "None"], ["low", "Low"], ["mid", "Medium"], ["high", "High"]];
const WHEN = [["now", "List now"], ["spring", "Spring (Mar–May)"]];
const MAT = [["leather", "Leather"], ["faux", "Leather look"]];
const THEMES = [["trachten", "Trachten"], ["outdoor", "Ski & outdoor"]];
const TYPES = [["jacket", "Jackets & coats"], ["trousers", "Jeans & trousers"], ["dress", "Dresses & skirts"], ["top", "Tops & blouses"], ["knit", "Knit & hoodies"], ["shoes", "Shoes"], ["bag", "Bags & belts"], ["swim", "Swimwear"], ["other", "Ties & other"]];
const COLS = [["black", "Black", "#111"], ["white", "White / cream", "#f4f1e8"], ["grey", "Grey", "#8f9592"], ["brown", "Brown / beige", "#8a6040"], ["red", "Red", "#c8262c"], ["pink", "Pink", "#ef8fb4"], ["blue", "Blue / navy", "#2b4f8f"], ["green", "Green / olive", "#5f7a3a"], ["purple", "Purple", "#6f3fa8"], ["yellow", "Yellow / gold", "#e3b52a"], ["print", "Pattern", "linear-gradient(135deg,#c8262c 0 33%,#2b4f8f 33% 66%,#e3b52a 66%)"]];
const TAGS = [...MAT, ...THEMES];
const NAME = (list) => Object.fromEntries(list.map(([v, l]) => [v, l]));
const ST_NAME = NAME(STATUS), INT_NAME = NAME(INTEREST), TYPE_NAME = NAME(TYPES), WHEN_NAME = NAME(WHEN),
  COL_NAME = NAME(COLS), TAG_NAME = NAME(TAGS);
const INT_RANK = { none: 0, low: 1, mid: 2, high: 3 };

// Editable fields, in form order. kind: text | long | num | int | select | picks
const FIELDS = [
  { k: "name", label: "Name", kind: "text", wide: true, group: "Item" },
  { k: "brand", label: "Brand", kind: "text", group: "Item" },
  { k: "size", label: "Size", kind: "text", group: "Item" },
  { k: "type", label: "Type", kind: "select", opts: [["", "—"], ...TYPES], group: "Item" },
  { k: "pieces", label: "Pieces", kind: "int", group: "Item" },
  { k: "status", label: "Status", kind: "select", opts: STATUS, group: "Item" },
  { k: "season", label: "Season", kind: "select", opts: WHEN, group: "Item" },
  { k: "where_sell", label: "Sell on", kind: "text", wide: true, group: "Item" },
  { k: "list_price", label: "List price €", kind: "num", group: "Prices" },
  { k: "min_price", label: "Min price €", kind: "num", group: "Prices" },
  { k: "buy_price", label: "Bought for €", kind: "num", group: "Prices" },
  { k: "sell_price", label: "Sold for €", kind: "num", group: "Prices" },
  { k: "interest", label: "Interest", kind: "select", opts: INTEREST, group: "Buyer interest" },
  { k: "views", label: "Views", kind: "int", group: "Buyer interest" },
  { k: "likes", label: "Likes", kind: "int", group: "Buyer interest" },
  { k: "colors", label: "Colours", kind: "picks", opts: COLS, wide: true, group: "Tags" },
  { k: "tags", label: "Material & theme", kind: "picks", opts: TAGS, wide: true, group: "Tags" },
  { k: "vinted_text", label: "Vinted listing text", kind: "long", wide: true, group: "Texts", copy: true },
  { k: "note", label: "Note", kind: "long", wide: true, group: "Texts" },
  { k: "owner_note", label: "Owner's price note", kind: "long", wide: true, group: "Texts" },
];
const FIELD = Object.fromEntries(FIELDS.map((f) => [f.k, f]));

// ---- helpers -------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eur = (n) => (n == null ? "—" : "€" + n.toLocaleString("de-AT", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }));
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD in local time

async function api(path, opts = {}) {
  const json = typeof opts.body === "string";
  const r = await fetch(path, { ...opts, headers: json ? { "content-type": "application/json" } : undefined });
  if (r.status === 401) {
    location.href = "/login";
    throw new Error("Not logged in");
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((data && data.error) || "Error " + r.status), { status: r.status, data });
  return data;
}

let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) document.body.append((t = Object.assign(document.createElement("div"), { className: "toast" })));
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---- state ---------------------------------------------------------------------
let ITEMS = [];
let view = [];
let curId = null; // item open in the dialog
let ph = 0; // photo index
const sel = { st: new Set(), int: new Set(), when: new Set(), mat: new Set(), type: new Set(), col: new Set(), theme: new Set() };
const byId = (id) => ITEMS.find((x) => x.id === id);
function replaceItem(item) {
  const i = ITEMS.findIndex((x) => x.id === item.id);
  if (i >= 0) ITEMS[i] = item;
  else ITEMS.push(item);
}

// ---- filters & grid ------------------------------------------------------------
function makeChips(gid, list, key) {
  const g = $(gid);
  for (const [v, label, col] of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", "false");
    if (col) {
      const s = document.createElement("span");
      s.className = "sw";
      s.style.background = col;
      b.append(s);
    }
    b.append(label);
    b.onclick = () => {
      sel[key].has(v) ? sel[key].delete(v) : sel[key].add(v);
      b.setAttribute("aria-pressed", sel[key].has(v));
      render();
    };
    g.append(b);
  }
}
makeChips("g-st", STATUS, "st");
makeChips("g-int", INTEREST, "int");
makeChips("g-when", WHEN, "when");
makeChips("g-mat", MAT, "mat");
makeChips("g-type", TYPES, "type");
makeChips("g-col", COLS, "col");
makeChips("g-theme", THEMES, "theme");

const anyOf = (set, vals) => set.size === 0 || vals.some((v) => set.has(v));
function filtered() {
  const q = $("q").value.trim().toLowerCase();
  const r = ITEMS.filter((it) =>
    anyOf(sel.st, [it.status]) && anyOf(sel.int, [it.interest]) && anyOf(sel.when, [it.season]) &&
    anyOf(sel.mat, it.tags) && anyOf(sel.type, [it.type]) && anyOf(sel.col, it.colors) && anyOf(sel.theme, it.tags) &&
    (!q || String(it.id) === q || [it.name, it.brand, it.size, it.vinted_text, it.note, it.owner_note, it.where_sell,
      it.colors.join(" "), TYPE_NAME[it.type]].join(" ").toLowerCase().includes(q)));
  const s = $("sort").value;
  const price = (x) => (x.status === "sold" ? x.sell_price : x.list_price) ?? 0;
  if (s === "hi") r.sort((a, b) => price(b) - price(a) || a.id - b.id);
  if (s === "lo") r.sort((a, b) => price(a) - price(b) || a.id - b.id);
  if (s === "int") r.sort((a, b) => INT_RANK[b.interest] - INT_RANK[a.interest] || (b.likes ?? 0) - (a.likes ?? 0) || a.id - b.id);
  if (s === "upd") r.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  if (s === "sold") r.sort((a, b) => String(b.sold_at ?? "").localeCompare(String(a.sold_at ?? "")) || a.id - b.id);
  return r;
}

function render() {
  view = filtered();
  const sale = view.filter((x) => x.status === "to_list" || x.status === "listed");
  const sold = view.filter((x) => x.status === "sold");
  const sum = (list, f) => list.reduce((t, x) => t + (f(x) ?? 0), 0);
  const withBuy = sold.filter((x) => x.buy_price != null && x.sell_price != null);
  const nk = view.filter((x) => x.status === "kept").length, nm = view.filter((x) => x.status === "maybe_keep").length;
  $("stats").innerHTML =
    `<span><b>${sale.length}</b> for sale · ${sum(sale, (x) => x.pieces)} pieces</span>` +
    `<span>List <b>${eur(sum(sale, (x) => x.list_price))}</b></span><span>Min <b>${eur(sum(sale, (x) => x.min_price))}</b></span>` +
    `<span><b>${sold.length}</b> sold · <b>${eur(sum(sold, (x) => x.sell_price))}</b></span>` +
    (withBuy.length ? `<span>Profit <b>${eur(sum(withBuy, (x) => x.sell_price - x.buy_price))}</b> (${withBuy.length} with cost)</span>` : "") +
    `<span><b>${nk}</b> keeping · <b>${nm}</b> maybe</span>` +
    (view.length === ITEMS.length ? "" : `<span>${view.length} of ${ITEMS.length} shown</span>`);

  const g = $("grid");
  g.innerHTML = "";
  $("empty").hidden = view.length > 0;
  for (const it of view) {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "card " + it.status;
    const thumb = it.photos[0] && it.photos[0].thumb;
    const badge = it.status === "to_list" ? "" : `<span class="st ${it.status}">${ST_NAME[it.status]}</span>`;
    const price = it.status === "sold"
      ? `<span class="tag">${eur(it.sell_price)}</span><span class="min">${esc(it.sold_at || "")}</span>`
      : `<span class="tag">${eur(it.list_price)}</span><span class="min">min ${eur(it.min_price)}</span>` +
        `<span class="when ${it.season}">${it.season === "now" ? "Now" : "Spring"}</span>`;
    const interest = it.interest !== "none"
      ? `<span class="int ${it.interest}">${INT_NAME[it.interest]} interest${it.likes ? " · ♥ " + it.likes : ""}</span>` : "";
    c.innerHTML = (thumb ? `<img class="ph" loading="lazy" src="${esc(thumb)}" alt="">` : `<div class="ph noph">No photo yet</div>`) +
      badge + `<div class="body"><span class="idn">#${it.id}</span><span class="nm">${esc(it.name)}</span>` +
      `<span class="br">${esc(it.brand || "")}${it.size ? " · " + esc(it.size) : ""}</span>` +
      `<div class="pr">${price}${interest}</div>` +
      (it.owner_note ? `<span class="own">Owner: ${esc(it.owner_note)}</span>` : "") + `</div>`;
    c.onclick = () => openItem(it.id);
    g.append(c);
  }
}
["q", "sort"].forEach((id) => $(id).addEventListener("input", render));
$("reset").onclick = () => {
  Object.values(sel).forEach((s) => s.clear());
  document.querySelectorAll(".chip[aria-pressed]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  $("q").value = "";
  $("sort").value = "id";
  render();
};
$("logout").onclick = async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
};
$("new").onclick = async () => {
  try {
    const item = await api("/api/items", { method: "POST", body: JSON.stringify({ name: "New item" }) });
    replaceItem(item);
    render();
    openItem(item.id);
  } catch (e) {
    toast(e.message);
  }
};

// ---- item dialog ---------------------------------------------------------------
const dlg = $("dlg");

function openItem(id) {
  curId = id;
  ph = 0;
  fill();
  if (!dlg.open) dlg.showModal();
}

function showPhotos() {
  const it = byId(curId);
  const n = it.photos.length;
  ph = Math.max(0, Math.min(ph, n - 1));
  $("big").hidden = !n;
  $("nophoto").hidden = !!n;
  $("cnt").hidden = !n;
  $("pl").hidden = $("pr").hidden = n < 2;
  $("strip").hidden = n < 2;
  $("phl").disabled = !n || ph === 0;
  $("phr").disabled = !n || ph === n - 1;
  $("phdel").disabled = !n;
  const strip = $("strip");
  strip.innerHTML = "";
  it.photos.forEach((p, k) => {
    const im = document.createElement("img");
    im.src = p.thumb;
    im.alt = "";
    im.className = k === ph ? "on" : "";
    im.onclick = () => { ph = k; showPhotos(); };
    strip.append(im);
  });
  if (!n) return;
  $("big").src = it.photos[ph].url;
  $("big").alt = it.name + " photo " + (ph + 1);
  $("cnt").textContent = ph + 1 + " / " + n;
}

// form values ⇄ item values
function norm(f, v) {
  if (f.kind === "picks") return Array.isArray(v) ? f.opts.map(([o]) => o).filter((o) => v.includes(o)) : [];
  if (v === undefined || v === null || v === "") return f.k === "name" ? "" : null;
  if (f.kind === "num" || f.kind === "int") return typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return typeof v === "string" ? v.trim() || (f.k === "name" ? "" : null) : v;
}
function readForm() {
  const out = {};
  for (const f of FIELDS) {
    const el = document.querySelector(`#info [data-k="${f.k}"]`);
    if (!el) continue;
    if (f.kind === "picks") out[f.k] = norm(f, [...el.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.v));
    else out[f.k] = norm(f, el.value);
  }
  return out;
}
function changes() {
  const it = byId(curId), now = readForm(), diff = {};
  for (const [k, v] of Object.entries(now)) if (JSON.stringify(v) !== JSON.stringify(norm(FIELD[k], it[k]))) diff[k] = v;
  return diff;
}
function invalid(diff) {
  for (const [k, v] of Object.entries(diff)) {
    const f = FIELD[k];
    if ((f.kind === "num" || f.kind === "int") && v !== null && (!Number.isFinite(v) || v < 0)) return `${f.label}: enter a number`;
    if (f.kind === "int" && v !== null && !Number.isInteger(v)) return `${f.label}: enter a whole number`;
    if (k === "name" && !v) return "Name cannot be empty";
  }
  return null;
}
function fmt(k, v) {
  const f = FIELD[k];
  if (v === null || v === "" || (Array.isArray(v) && !v.length)) return "—";
  if (f.kind === "picks") return v.map((x) => COL_NAME[x] || TAG_NAME[x] || x).join(", ");
  if (f.kind === "select") return (f.opts.find(([o]) => o === v) || [v, v])[1];
  if (f.kind === "num") return Number.isFinite(v) ? eur(v) : String(v);
  return String(v);
}

function fieldHtml(f, it) {
  const v = it[f.k];
  let input;
  if (f.kind === "select") {
    const locked = f.k === "status" && it.status === "sold";
    const opts = f.k === "status" && !locked ? f.opts.filter(([o]) => o !== "sold") : f.opts;
    input = `<select data-k="${f.k}"${locked ? ' disabled title="Use “Undo sale” to change"' : ""}>` +
      opts.map(([o, l]) => `<option value="${esc(o)}"${(v ?? "") === o ? " selected" : ""}>${esc(l)}</option>`).join("") + `</select>`;
  } else if (f.kind === "picks") {
    input = `<div class="picks" data-k="${f.k}">` + f.opts.map(([o, l, col]) =>
      `<button type="button" class="chip" data-v="${esc(o)}" aria-pressed="${(v || []).includes(o)}">` +
      (col ? `<span class="sw" style="background:${col}"></span>` : "") + `${esc(l)}</button>`).join("") + `</div>`;
  } else if (f.kind === "long") {
    input = `<textarea data-k="${f.k}" rows="${f.copy ? 5 : 3}">${esc(v)}</textarea>`;
  } else {
    const numeric = f.kind === "num" || f.kind === "int";
    input = `<input data-k="${f.k}" value="${esc(v)}"${numeric ? ` inputmode="${f.kind === "num" ? "decimal" : "numeric"}"` : ""} autocomplete="off">`;
  }
  const copy = f.copy ? `<div class="btns"><button class="btn" type="button" id="copy">Copy text</button></div>` : "";
  // Chip groups sit in a <div>: inside a <label>, a tap on the caption would toggle the first chip.
  const tag = f.kind === "picks" ? "div" : "label";
  return `<${tag} class="f${f.wide ? " wide" : ""}${f.copy ? " vinted" : ""}" data-field="${f.k}"><span>${esc(f.label)}</span>${input}</${tag}>${copy}`;
}

function fill() {
  const it = byId(curId);
  const idx = view.findIndex((x) => x.id === it.id);
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const banner = it.status === "sold"
    ? `<div class="banner"><span>Sold <b>${eur(it.sell_price)}</b> on ${esc(it.sold_at || "?")}</span>` +
      `<button class="btn" type="button" id="unsell">Undo sale</button></div>` : "";
  $("info").innerHTML =
    `<div class="sub">#${it.id}${idx >= 0 ? ` · ${idx + 1} of ${view.length} shown` : ""} · ${ST_NAME[it.status]}</div>` +
    `<h2>${esc(it.name)}</h2>` + banner +
    groups.map((g) => `<fieldset><legend>${esc(g)}</legend><div class="fgrid">` +
      FIELDS.filter((f) => f.group === g).map((f) => fieldHtml(f, it)).join("") +
      (g === "Prices" ? `<div class="money wide" id="money" style="grid-column:1/-1"></div>` : "") +
      `</div></fieldset>`).join("") +
    `<div class="savebar"><div class="btns">` +
    `<button class="btn" type="button" id="pv">‹ Prev</button><button class="btn" type="button" id="nx">Next ›</button>` +
    (it.status !== "sold" ? `<button class="btn" type="button" id="sell">Sold…</button>` : "") +
    `</div><div class="btns"><span class="dirty" id="dirty" hidden>Unsaved changes</span>` +
    `<button class="btn" type="button" id="revert" hidden>Discard</button>` +
    `<button class="btn pri" type="button" id="save" disabled>Save…</button></div></div>`;

  const info = $("info");
  info.querySelectorAll(".picks .chip").forEach((b) => (b.onclick = () => {
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
    onEdit();
  }));
  $("copy").onclick = async (e) => {
    const ta = info.querySelector('[data-k="vinted_text"]');
    try {
      await navigator.clipboard.writeText(ta.value);
      e.currentTarget.textContent = "Copied";
    } catch {
      ta.select();
      e.currentTarget.textContent = "Selected — press copy";
    }
  };
  $("pv").onclick = () => step(-1);
  $("nx").onclick = () => step(1);
  $("save").onclick = openApprove;
  $("revert").onclick = () => fill();
  if ($("sell")) $("sell").onclick = openSell;
  if ($("unsell")) $("unsell").onclick = unsell;
  onEdit();
  showPhotos();
}

$("info").addEventListener("input", () => onEdit());
$("info").addEventListener("change", () => onEdit());

function onEdit() {
  if (!$("save")) return;
  const diff = changes();
  const n = Object.keys(diff).length;
  document.querySelectorAll("#info .f").forEach((l) => l.classList.toggle("changed", l.dataset.field in diff));
  $("dirty").hidden = $("revert").hidden = !n;
  $("save").disabled = !n;
  // live money line
  const v = readForm();
  const parts = [];
  if (v.buy_price != null && v.sell_price != null) {
    const p = v.sell_price - v.buy_price;
    parts.push(`Profit <b class="${p >= 0 ? "pos" : "neg"}">${eur(p)}</b>`);
  } else if (v.buy_price != null && v.list_price != null) {
    parts.push(`At list price: <b>${eur(v.list_price - v.buy_price)}</b> profit`);
  } else {
    parts.push(`Enter “Bought for” to see profit`);
  }
  $("money").innerHTML = parts.join(" · ");
}

const isDirty = () => dlg.open && curId != null && Object.keys(changes()).length > 0;
const okToLeave = () => !isDirty() || confirm("Discard unsaved changes?");

function step(d) {
  if (!view.length || !okToLeave()) return;
  const i = view.findIndex((x) => x.id === curId);
  const next = view[(i + d + view.length) % view.length];
  openItem(next.id);
}
$("pl").onclick = () => { ph--; showPhotos(); };
$("pr").onclick = () => { ph++; showPhotos(); };
$("x").onclick = () => okToLeave() && dlg.close();
dlg.addEventListener("cancel", (e) => { if (!okToLeave()) e.preventDefault(); });
dlg.addEventListener("click", (e) => { if (e.target === dlg && okToLeave()) dlg.close(); });
document.addEventListener("keydown", (e) => {
  if (!dlg.open || $("approve").open || $("selldlg").open) return;
  if (e.target.closest("input,textarea,select")) return;
  const n = byId(curId).photos.length;
  if (e.key === "ArrowRight" && n > 1) { ph = (ph + 1) % n; showPhotos(); }
  if (e.key === "ArrowLeft" && n > 1) { ph = (ph - 1 + n) % n; showPhotos(); }
});
let sx = null;
$("viewer").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
$("viewer").addEventListener("touchend", (e) => {
  if (sx === null) return;
  const dx = e.changedTouches[0].clientX - sx, n = byId(curId).photos.length;
  if (Math.abs(dx) > 40 && n > 1) { ph = (ph + (dx < 0 ? 1 : -1) + n) % n; showPhotos(); }
  sx = null;
});

// ---- approve (was → now) -------------------------------------------------------
let pending = null;
function openApprove() {
  const diff = changes();
  const bad = invalid(diff);
  if (bad) return toast(bad);
  const it = byId(curId);
  pending = diff;
  $("diffrows").innerHTML = Object.entries(diff).map(([k, v]) =>
    `<tr><th>${esc(FIELD[k].label)}</th><td class="old">${esc(fmt(k, norm(FIELD[k], it[k])))}</td><td class="new">${esc(fmt(k, v))}</td></tr>`).join("");
  $("saveerr").hidden = true;
  $("ok").disabled = false;
  $("approve").showModal();
}
$("back").onclick = () => $("approve").close();
$("ok").onclick = async () => {
  const it = byId(curId);
  $("ok").disabled = true;
  try {
    const saved = await api(`/api/items/${it.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...pending, base_updated_at: it.updated_at }),
    });
    replaceItem(saved);
    $("approve").close();
    render();
    fill();
    toast("Saved");
  } catch (e) {
    if (e.status === 409 && e.data && e.data.current) {
      replaceItem(e.data.current);
      render();
      $("approve").close();
      fill();
      alert(e.message + "\n\nThe latest version is now shown. Make your change again.");
      return;
    }
    $("saveerr").textContent = e.message;
    $("saveerr").hidden = false;
    $("ok").disabled = false;
  }
};

// ---- sold / undo ---------------------------------------------------------------
$("s-int").innerHTML = INTEREST.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
function openSell() {
  if (isDirty()) return toast("Save or discard your changes first");
  const it = byId(curId);
  $("s-price").value = it.list_price ?? "";
  $("s-date").value = today();
  $("s-int").value = it.interest;
  $("sellerr").hidden = true;
  $("selldlg").showModal();
}
$("sellback").onclick = () => $("selldlg").close();
$("sellform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = $("s-price").value.trim().replace(",", ".");
  const price = raw === "" ? null : Number(raw);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    $("sellerr").textContent = "Enter a price or leave it empty";
    $("sellerr").hidden = false;
    return;
  }
  try {
    const saved = await api(`/api/items/${curId}/sell`, {
      method: "POST",
      body: JSON.stringify({ sell_price: price, sold_at: $("s-date").value, interest: $("s-int").value }),
    });
    replaceItem(saved);
    $("selldlg").close();
    render();
    fill();
    toast("Marked as sold");
  } catch (err) {
    $("sellerr").textContent = err.message;
    $("sellerr").hidden = false;
  }
});
async function unsell() {
  if (isDirty()) return toast("Save or discard your changes first");
  if (!confirm("Undo this sale? The item goes back to its previous status and the sale price and date are cleared.")) return;
  try {
    replaceItem(await api(`/api/items/${curId}/unsell`, { method: "POST" }));
    render();
    fill();
    toast("Sale undone");
  } catch (e) {
    toast(e.message);
  }
}

// ---- photos: resize in the browser, then upload --------------------------------
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
async function resize(src, maxSide, quality) {
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const cv = document.createElement("canvas");
  cv.width = Math.round(w0 * s);
  cv.height = Math.round(h0 * s);
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  const blob = (type) => new Promise((r) => cv.toBlob(r, type, quality));
  let b = await blob("image/webp");
  if (!b || b.type !== "image/webp") b = await blob("image/jpeg");
  return b;
}
$("addph").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  const id = curId;
  for (let i = 0; i < files.length; i++) {
    $("phstatus").textContent = `Uploading ${i + 1} of ${files.length}…`;
    try {
      const img = await decode(files[i]);
      const [full, thumb] = [await resize(img, 1600, 0.82), await resize(img, 480, 0.75)];
      if (img.close) img.close();
      const fd = new FormData();
      const ext = full.type === "image/webp" ? "webp" : "jpg";
      fd.append("full", full, "full." + ext);
      fd.append("thumb", thumb, "thumb." + ext);
      const saved = await api(`/api/items/${id}/photos`, { method: "POST", body: fd });
      byId(id).photos = saved.photos; // keep any unsaved form edits
      if (curId === id) { ph = saved.photos.length - 1; showPhotos(); }
    } catch (err) {
      toast(`Photo ${i + 1}: ${err.message}`);
    }
  }
  $("phstatus").textContent = "";
  render();
});
async function movePhoto(d) {
  const it = byId(curId);
  const ids = it.photos.map((p) => p.id);
  const j = ph + d;
  if (j < 0 || j >= ids.length) return;
  [ids[ph], ids[j]] = [ids[j], ids[ph]];
  try {
    it.photos = (await api(`/api/items/${it.id}/photo-order`, { method: "PUT", body: JSON.stringify({ ids }) })).photos;
    ph = j;
    showPhotos();
    render();
  } catch (e) {
    toast(e.message);
  }
}
$("phl").onclick = () => movePhoto(-1);
$("phr").onclick = () => movePhoto(1);
$("phdel").onclick = async () => {
  const it = byId(curId);
  const p = it.photos[ph];
  if (!p || !confirm("Delete this photo? This cannot be undone.")) return;
  try {
    it.photos = (await api(`/api/photos/${p.id}`, { method: "DELETE" })).photos;
    showPhotos();
    render();
  } catch (e) {
    toast(e.message);
  }
};

// ---- start ---------------------------------------------------------------------
(async () => {
  try {
    ITEMS = await api("/api/items");
    render();
  } catch (e) {
    $("empty").hidden = false;
    $("empty").textContent = "Could not load items: " + e.message;
  }
})();
