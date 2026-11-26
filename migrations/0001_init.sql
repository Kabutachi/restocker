-- Items for resale. Sales live on the item row (sold_at / sell_price); prev_status lets a sale be undone.
CREATE TABLE items (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL DEFAULT '',
  brand        TEXT,
  size         TEXT,
  where_sell   TEXT,
  season       TEXT    NOT NULL DEFAULT 'now' CHECK (season IN ('now', 'spring')),
  note         TEXT,
  owner_note   TEXT,
  vinted_text  TEXT,
  list_price   REAL,
  min_price    REAL,
  buy_price    REAL,
  sell_price   REAL,
  sold_at      TEXT,
  status       TEXT    NOT NULL DEFAULT 'to_list'
               CHECK (status IN ('to_list', 'listed', 'kept', 'maybe_keep', 'sold')),
  prev_status  TEXT,
  interest     TEXT    NOT NULL DEFAULT 'none' CHECK (interest IN ('none', 'low', 'mid', 'high')),
  views        INTEGER,
  likes        INTEGER,
  type         TEXT,
  colors_json  TEXT    NOT NULL DEFAULT '[]',
  tags_json    TEXT    NOT NULL DEFAULT '[]',
  pieces       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE photos (
  id         TEXT    PRIMARY KEY,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  r2_key     TEXT    NOT NULL,
  thumb_key  TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX photos_by_item ON photos (item_id, position);
