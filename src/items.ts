// Item fields the API accepts, with their validation. Anything not listed here is ignored.

export const STATUSES = ["to_list", "listed", "kept", "maybe_keep", "sold"] as const;
export const INTERESTS = ["none", "low", "mid", "high"] as const;
export const SEASONS = ["now", "spring"] as const;

type Kind = "text" | "num" | "int" | "json";
const FIELDS: Record<string, { col: string; kind: Kind; values?: readonly string[] }> = {
  name: { col: "name", kind: "text" },
  brand: { col: "brand", kind: "text" },
  size: { col: "size", kind: "text" },
  where_sell: { col: "where_sell", kind: "text" },
  note: { col: "note", kind: "text" },
  owner_note: { col: "owner_note", kind: "text" },
  vinted_text: { col: "vinted_text", kind: "text" },
  type: { col: "type", kind: "text" },
  sold_at: { col: "sold_at", kind: "text" },
  season: { col: "season", kind: "text", values: SEASONS },
  status: { col: "status", kind: "text", values: STATUSES },
  interest: { col: "interest", kind: "text", values: INTERESTS },
  list_price: { col: "list_price", kind: "num" },
  min_price: { col: "min_price", kind: "num" },
  buy_price: { col: "buy_price", kind: "num" },
  sell_price: { col: "sell_price", kind: "num" },
  views: { col: "views", kind: "int" },
  likes: { col: "likes", kind: "int" },
  pieces: { col: "pieces", kind: "int" },
  colors: { col: "colors_json", kind: "json" },
  tags: { col: "tags_json", kind: "json" },
};

const NOT_NULL = new Set(["name", "season", "status", "interest", "pieces"]);

export type Clean = { cols: string[]; vals: (string | number | null)[] };

/** Validate a partial item. Returns columns/values to write, or an error message. */
export function cleanFields(body: Record<string, unknown>): Clean | string {
  const cols: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [field, raw] of Object.entries(body)) {
    const f = FIELDS[field];
    if (!f) continue;
    let v: string | number | null;
    if (raw === null || raw === "") {
      if (NOT_NULL.has(field)) return `${field} cannot be empty`;
      v = f.kind === "json" ? "[]" : null;
    } else if (f.kind === "text") {
      if (typeof raw !== "string") return `${field} must be text`;
      if (raw.length > 5000) return `${field} is too long`;
      if (f.values && !f.values.includes(raw)) return `${field} must be one of ${f.values.join(", ")}`;
      if (field === "sold_at" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "sold_at must be YYYY-MM-DD";
      v = raw;
    } else if (f.kind === "num" || f.kind === "int") {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return `${field} must be a number ≥ 0`;
      if (f.kind === "int" && !Number.isInteger(n)) return `${field} must be a whole number`;
      v = f.kind === "num" ? Math.round(n * 100) / 100 : n;
    } else {
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string" && x.length <= 40) || raw.length > 30)
        return `${field} must be a list of short words`;
      v = JSON.stringify(raw);
    }
    cols.push(f.col);
    vals.push(v);
  }
  return { cols, vals };
}

type Row = Record<string, unknown>;

/** One malformed row must not take the whole list down. */
function list(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toItem(r: Row, photos: Row[]) {
  const { colors_json, tags_json, ...rest } = r;
  return {
    ...rest,
    colors: list(colors_json),
    tags: list(tags_json),
    photos: photos.map((p) => ({
      id: p.id,
      url: "/img/" + p.r2_key,
      thumb: "/img/" + p.thumb_key,
      position: p.position,
    })),
  };
}
