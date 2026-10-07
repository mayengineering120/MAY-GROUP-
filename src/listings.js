const fs = require('node:fs');
const path = require('node:path');
const { db, transaction } = require('./db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const { CURRENCIES } = require('./helpers');

const STATUS_LABELS = {
  available: 'Available',
  under_offer: 'Under offer',
  sold: 'Sold',
  ongoing: 'Ongoing',
  completed: 'Completed',
};

const TYPES = {
  machinery: {
    key: 'machinery',
    label: 'Machinery',
    singular: 'Machine',
    path: 'machinery',
    statuses: ['available', 'under_offer', 'sold'],
  },
  project: {
    key: 'project',
    label: 'Projects',
    singular: 'Project',
    path: 'projects',
    // "ongoing" and "completed" are portfolio projects shown off rather than sold.
    statuses: ['available', 'under_offer', 'sold', 'ongoing', 'completed'],
  },
};

// Public filter tabs: each maps to a set of statuses.
const FILTERS = {
  machinery: [
    { key: 'available', label: 'Available', statuses: ['available', 'under_offer'] },
    { key: 'sold', label: 'Sold', statuses: ['sold'] },
    { key: 'all', label: 'All', statuses: TYPES.machinery.statuses },
  ],
  project: [
    { key: 'available', label: 'For sale', statuses: ['available', 'under_offer'] },
    { key: 'portfolio', label: 'Our work', statuses: ['ongoing', 'completed'] },
    { key: 'sold', label: 'Sold', statuses: ['sold'] },
    { key: 'all', label: 'All', statuses: TYPES.project.statuses },
  ],
};

function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'listing'
  );
}

function uniqueSlug(title, excludeId = 0) {
  const base = slugify(title);
  const exists = db.prepare('SELECT 1 FROM listings WHERE slug = ? AND id != ?');
  let slug = base;
  for (let n = 2; exists.get(slug, excludeId); n++) slug = `${base}-${n}`;
  return slug;
}

function attachCovers(rows) {
  const cover = db.prepare('SELECT filename FROM images WHERE listing_id = ? ORDER BY sort_order, id LIMIT 1');
  for (const row of rows) row.cover = cover.get(row.id)?.filename || null;
  return rows;
}

/**
 * Search listings.
 * opts: { type, statuses, q, category, publishedOnly, featured, limit, offset, order }
 */
function search(opts = {}) {
  const where = [];
  const params = [];
  if (opts.type) {
    where.push('type = ?');
    params.push(opts.type);
  }
  if (opts.statuses?.length) {
    where.push(`status IN (${opts.statuses.map(() => '?').join(',')})`);
    params.push(...opts.statuses);
  }
  if (opts.publishedOnly) where.push('published = 1');
  if (opts.featured) where.push('featured = 1');
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  if (opts.q) {
    where.push("(title LIKE ? ESCAPE '\\' OR make LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')");
    const like = `%${String(opts.q).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM listings ${whereSql}`).get(...params).n;
  const order = opts.order || "CASE status WHEN 'sold' THEN 1 ELSE 0 END, featured DESC, created_at DESC, id DESC";
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;
  const rows = db
    .prepare(`SELECT * FROM listings ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { rows: attachCovers(rows), total };
}

function categories(type, publishedOnly = true) {
  return db
    .prepare(
      `SELECT DISTINCT category FROM listings WHERE type = ? AND category != '' ${publishedOnly ? 'AND published = 1' : ''} ORDER BY category`,
    )
    .all(type)
    .map((r) => r.category);
}

function findById(id) {
  return db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
}

function findBySlug(type, slug) {
  return db.prepare('SELECT * FROM listings WHERE type = ? AND slug = ?').get(type, slug);
}

function images(listingId) {
  return db.prepare('SELECT * FROM images WHERE listing_id = ? ORDER BY sort_order, id').all(listingId);
}

const toInt = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const toPrice = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const str = (v, max = 5000) => String(v ?? '').trim().slice(0, max);

/** Validate and normalise form input. Returns { data, errors }. */
function fromForm(type, body) {
  const cfg = TYPES[type];
  const data = {
    title: str(body.title, 200),
    category: str(body.category, 100),
    status: cfg.statuses.includes(body.status) ? body.status : 'available',
    published: body.published ? 1 : 0,
    featured: body.featured ? 1 : 0,
    summary: str(body.summary, 300),
    description: str(body.description, 20000),
    location: str(body.location, 200),
    price: toPrice(body.price),
    price_currency: CURRENCIES.includes(body.price_currency) ? body.price_currency : 'AED',
    price_on_request: body.price_on_request ? 1 : 0,
    make: str(body.make, 100),
    model: str(body.model, 100),
    year: toInt(body.year),
    hours: toInt(body.hours),
    condition: str(body.condition, 100),
    client: str(body.client, 200),
    completed_on: str(body.completed_on, 50),
    internal_notes: str(body.internal_notes, 10000),
  };
  const errors = [];
  if (!data.title) errors.push('Title is required.');
  if (data.year !== null && (data.year < 1900 || data.year > 2100)) errors.push('Year looks invalid.');
  if (data.price !== null && data.price < 0) errors.push('Price cannot be negative.');
  return { data, errors };
}

const FIELDS = [
  'title', 'category', 'status', 'published', 'featured', 'summary', 'description', 'location', 'price',
  'price_currency', 'price_on_request', 'make', 'model', 'year', 'hours', 'condition', 'client', 'completed_on', 'internal_notes',
];

function create(type, data, userId) {
  const cols = [...FIELDS, 'type', 'slug', 'created_by', 'updated_by', 'sold_at'];
  const values = [
    ...FIELDS.map((f) => data[f]),
    type,
    uniqueSlug(data.title),
    userId,
    userId,
    data.status === 'sold' ? new Date().toISOString() : null,
  ];
  const result = db
    .prepare(`INSERT INTO listings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...values);
  return Number(result.lastInsertRowid);
}

function update(id, data, userId) {
  const existing = findById(id);
  const soldAt =
    data.status === 'sold' ? existing.sold_at || new Date().toISOString() : null;
  const slug = existing.title === data.title ? existing.slug : uniqueSlug(data.title, id);
  db.prepare(
    `UPDATE listings SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, slug = ?, sold_at = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(...FIELDS.map((f) => data[f]), slug, soldAt, userId, id);
}

function setStatus(id, status, userId) {
  const existing = findById(id);
  if (!existing || !TYPES[existing.type].statuses.includes(status)) return false;
  const soldAt = status === 'sold' ? existing.sold_at || new Date().toISOString() : null;
  db.prepare("UPDATE listings SET status = ?, sold_at = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(
    status, soldAt, userId, id,
  );
  return true;
}

function addImages(listingId, filenames) {
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM images WHERE listing_id = ?').get(listingId).m;
  const stmt = db.prepare('INSERT INTO images (listing_id, filename, sort_order) VALUES (?, ?, ?)');
  filenames.forEach((f, i) => stmt.run(listingId, f, max + 1 + i));
}

function unlinkUpload(filename) {
  fs.rm(path.join(UPLOAD_DIR, path.basename(filename)), { force: true }, () => {});
}

function removeImage(listingId, imageId) {
  const img = db.prepare('SELECT * FROM images WHERE id = ? AND listing_id = ?').get(imageId, listingId);
  if (!img) return;
  db.prepare('DELETE FROM images WHERE id = ?').run(imageId);
  unlinkUpload(img.filename);
}

/** Move an image to the front so it becomes the cover photo. */
function makeCover(listingId, imageId) {
  transaction(() => {
    const imgs = images(listingId);
    const ordered = [...imgs.filter((i) => i.id === imageId), ...imgs.filter((i) => i.id !== imageId)];
    const stmt = db.prepare('UPDATE images SET sort_order = ? WHERE id = ?');
    ordered.forEach((img, i) => stmt.run(i, img.id));
  });
}

function remove(id) {
  const imgs = images(id);
  db.prepare('DELETE FROM listings WHERE id = ?').run(id);
  imgs.forEach((img) => unlinkUpload(img.filename));
}

module.exports = {
  TYPES, FILTERS, STATUS_LABELS, UPLOAD_DIR,
  search, categories, findById, findBySlug, images, fromForm, create, update, setStatus,
  addImages, removeImage, makeCover, remove, slugify, unlinkUpload,
};
