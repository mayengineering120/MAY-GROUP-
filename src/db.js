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
  type             TEXT NOT NULL CHECK (type IN ('machinery', 'project', 'property')),
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
  rent_year        REAL,
  rent_on_request  INTEGER NOT NULL DEFAULT 0,
  bedrooms         INTEGER,
  bathrooms        INTEGER,
  area             REAL,
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
  services: 'Engineering\nHeavy equipment\nMachinery trading\nMachinery rental\nReal estate\nEquipment sourcing',
  ceo_name: 'Ghalib Darwish',
  phone: '+971 7378304\n+971 7865596\n+92 332 7378305',
  whatsapp: '+92 332 7378305',
  email: 'musbahalyaqootengineering@gmail.com',
  notify_email: 'musbahalyaqootengineering@gmail.com',
  address: '',
  hours: 'Sunday – Thursday: 7:00 AM – 6:00 PM\nFriday & Saturday: Closed',
  default_currency: 'AED',
  registration: 'SMC-Private Limited',
  google_site_verification: 'U8PTb60tKA2z4aFeILfI75LvMjoYAQfW6cKGG-M17Is',
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
addColumn('rent_year', 'REAL');
addColumn('rent_on_request', 'INTEGER NOT NULL DEFAULT 0');
addColumn('bedrooms', 'INTEGER');
addColumn('bathrooms', 'INTEGER');
addColumn('area', 'REAL');

// Older databases only allowed 'machinery' and 'project' listings. SQLite can't change a CHECK
// constraint in place, so rebuild the table (keeping every row and id) to allow 'property'.
const listingsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'listings'").get().sql;
if (!listingsSql.includes("'property'")) {
  const newSql = listingsSql
    .replace(/CHECK \(type IN \('machinery', 'project'\)\)/, "CHECK (type IN ('machinery', 'project', 'property'))")
    .replace(/^CREATE TABLE (IF NOT EXISTS )?"?listings"?/, 'CREATE TABLE listings_new');
  if (!newSql.includes("'property'") || !newSql.startsWith('CREATE TABLE listings_new')) {
    throw new Error('Could not upgrade the listings table to allow real estate.');
  }
  const cols = db.prepare('PRAGMA table_info(listings)').all().map((c) => `"${c.name}"`).join(', ');
  db.exec('PRAGMA foreign_keys = OFF'); // so dropping the old table doesn't delete photos/enquiries
  db.exec('BEGIN');
  try {
    db.exec(newSql);
    db.exec(`INSERT INTO listings_new (${cols}) SELECT ${cols} FROM listings`);
    db.exec('DROP TABLE listings');
    db.exec('ALTER TABLE listings_new RENAME TO listings');
    db.exec('CREATE INDEX IF NOT EXISTS idx_listings_type_status ON listings(type, status)');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
db.exec("DELETE FROM settings WHERE key = 'currency'");

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

// One-off content changes for the live site. Each runs once, ever; add new ones at the end
// (settings changed this way can still be edited afterwards in the staff portal).
db.exec(`CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))`);
const ONE_OFF_MIGRATIONS = {
  '2026-10-google-search-console': () =>
    db.prepare("UPDATE settings SET value = ? WHERE key = 'google_site_verification' AND value = ''").run('U8PTb60tKA2z4aFeILfI75LvMjoYAQfW6cKGG-M17Is'),
  '2026-10-whatsapp-pakistan-number': () =>
    db.prepare("UPDATE settings SET value = ? WHERE key = 'whatsapp'").run('+92 332 7378305'),
  '2026-10-real-estate-service': () =>
    db.prepare(
      "UPDATE settings SET value = value || char(10) || 'Real estate' WHERE key = 'services' AND value NOT LIKE '%real estate%'",
    ).run(),
};
for (const [name, run] of Object.entries(ONE_OFF_MIGRATIONS)) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(name)) continue;
  run();
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
}

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
