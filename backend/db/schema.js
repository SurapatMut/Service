const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'warehouse.db');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      sku         TEXT,
      type        TEXT    NOT NULL CHECK(type IN ('install','service','free')),
      category    TEXT,
      qty         INTEGER NOT NULL DEFAULT 0,
      unit        TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS serials (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      serial     TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'in_stock' CHECK(status IN ('in_stock','used')),
      created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      item_name  TEXT    NOT NULL,
      item_type  TEXT    NOT NULL,
      qty        INTEGER NOT NULL DEFAULT 1,
      note       TEXT,
      used_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS usage_serials (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      log_id   INTEGER NOT NULL REFERENCES usage_logs(id) ON DELETE CASCADE,
      serial   TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_serials_item ON serials(item_id);
    CREATE INDEX IF NOT EXISTS idx_logs_item    ON usage_logs(item_id);
    CREATE INDEX IF NOT EXISTS idx_logs_date    ON usage_logs(used_at);
  `);

  db.close();
  console.log('Database initialized at', DB_PATH);
}

module.exports = { getDb, initDb };
