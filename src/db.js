const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'site.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS listings (
  id               INTEGER PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('machinery', 'project')),
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  category         TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'available',
  published        INTEGER NOT NULL DEFAULT 1,
  featured         INTEGER NOT NULL DEFAULT 0,
  summary          TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',
  price            REAL,
  price_currency   TEXT NOT NULL DEFAULT 'AED',
  offer_type       TEXT NOT NULL DEFAULT 'sale',
  rent_day         REAL,
  rent_week        REAL,
  rent_month       REAL,
  price_on_request INTEGER NOT NULL DEFAULT 0,
  make             TEXT NOT NULL DEFAULT '',
  model            TEXT NOT NULL DEFAULT '',
  year             INTEGER,
  hours            INTEGER,
  condition        TEXT NOT NULL DEFAULT '',
  client           TEXT NOT NULL DEFAULT '',
  completed_on     TEXT NOT NULL DEFAULT '',
  internal_notes   TEXT NOT NULL DEFAULT '',
  sold_at          TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_type_status ON listings(type, status);

CREATE TABLE IF NOT EXISTS images (
  id         INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_listing ON images(listing_id, sort_order);

CREATE TABLE IF NOT EXISTS enquiries (
  id         INTEGER PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL,
  handled    INTEGER NOT NULL DEFAULT 0,
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  data    TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

// Default company details, editable by admins from the staff portal.
const DEFAULT_SETTINGS = {
  company_name: 'MAY Group',
  subtitle: 'Musbah Al Yaqoot',
  tagline: 'Engineering | Heavy Equipment | Machinery Trading',
  about:
    'MAY Group (Musbah Al Yaqoot) is an engineering, heavy equipment and machinery trading company. ' +
    'We sell and rent out quality machinery and deliver engineering projects for our clients.\n\n' +
    'Edit this text from the staff portal under Company Details.',
  services: 'Engineering\nHeavy equipment\nMachinery trading\nMachinery rental\nEquipment sourcing',
  ceo_name: 'Ghalib Darwish',
  phone: '+971 7378304\n+971 7865596\n+92 332 7378305',
  whatsapp: '+971 737 8972',
  email: 'musbahalyaqootengineering@gmail.com',
  notify_email: 'musbahalyaqootengineering@gmail.com',
  address: '',
  hours: 'Sunday – Thursday: 7:00 AM – 6:00 PM\nFriday & Saturday: Closed',
  default_currency: 'AED',
  registration: 'SMC-Private Limited',
};
// Migrations for databases created by earlier versions.
const listingCols = db.prepare('PRAGMA table_info(listings)').all().map((c) => c.name);
const addColumn = (name, def) => {
  if (!listingCols.includes(name)) db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${def}`);
};
addColumn('price_currency', "TEXT NOT NULL DEFAULT 'AED'");
addColumn('offer_type', "TEXT NOT NULL DEFAULT 'sale'");
addColumn('rent_day', 'REAL');
addColumn('rent_week', 'REAL');
addColumn('rent_month', 'REAL');
db.exec("DELETE FROM settings WHERE key = 'currency'");

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function saveSettings(values) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in values) stmt.run(key, String(values[key] ?? '').trim());
  }
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, getSettings, saveSettings, transaction, DEFAULT_SETTINGS, DATA_DIR };
