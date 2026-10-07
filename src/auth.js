const crypto = require('node:crypto');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR } = require('./db');

/** express-session store backed by the SQLite database, so logins survive restarts. */
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare(
      'INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires',
    );
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 60 * 60 * 1000).unref();
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }
  set(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      this.setStmt.run(sid, JSON.stringify(sess), expires);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }
  destroy(sid, cb) {
    try {
      this.delStmt.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }
  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

/** Without SESSION_SECRET, generate one once and keep it in the data folder so logins survive restarts. */
function persistentSecret() {
  const file = path.join(DATA_DIR, 'session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET || persistentSecret();
  return session({
    name: 'may.sid',
    secret,
    store: new SqliteStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours of inactivity
    },
  });
}

/**
 * Exposes csrf() to templates. The token is created lazily, so plain page views
 * by visitors don't create a session; only pages that render a form do.
 */
function csrfToken(req, res, next) {
  res.locals.csrf = () => {
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
    return req.session.csrf;
  };
  next();
}

/** Rejects POSTs without a valid token. Use after body parsing (incl. multer for uploads). */
function verifyCsrf(req, res, next) {
  const sent = String(req.body?._csrf || req.get('x-csrf-token') || '');
  const expected = req.session?.csrf || '';
  const ok =
    sent.length === expected.length && expected.length > 0 && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) {
    const err = new Error('Your form session expired. Please go back, refresh the page and try again.');
    err.status = 403;
    return next(err);
  }
  next();
}

function loadUser(req, res, next) {
  res.locals.user = null;
  const id = req.session?.userId;
  if (id) {
    const user = db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?').get(id);
    if (user && user.active) {
      req.user = user;
      res.locals.user = user;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

function requireStaff(req, res, next) {
  if (req.user) return next();
  res.redirect(`/staff/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  const err = new Error('Only administrators can do that.');
  err.status = 403;
  next(err);
}

// Simple in-memory login throttle: 10 failed attempts per IP+email per 15 minutes.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function throttleKey(req, email) {
  return `${req.ip}|${String(email).toLowerCase()}`;
}
function isThrottled(req, email) {
  const a = attempts.get(throttleKey(req, email));
  return a && a.count >= 10 && Date.now() - a.first < WINDOW_MS;
}
function recordFailure(req, email) {
  const key = throttleKey(req, email);
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
function clearFailures(req, email) {
  attempts.delete(throttleKey(req, email));
}

// Constant-ish time for unknown emails so response timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function authenticate(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
  const ok = bcrypt.compareSync(String(password), user?.password_hash || DUMMY_HASH);
  if (!user || !ok || !user.active) return null;
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  return user;
}

function checkPassword(userId, password) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  return !!row && bcrypt.compareSync(String(password), row.password_hash);
}

function validatePassword(pw) {
  if (String(pw).length < 10) return 'Password must be at least 10 characters.';
  return null;
}

function hashPassword(pw) {
  return bcrypt.hashSync(String(pw), 12);
}

function createUser({ name, email, password, role }) {
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), String(email).trim().toLowerCase(), hashPassword(password), role === 'admin' ? 'admin' : 'staff');
  return Number(result.lastInsertRowid);
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

module.exports = {
  sessionMiddleware, csrfToken, verifyCsrf, loadUser, requireStaff, requireAdmin,
  isThrottled, recordFailure, clearFailures, authenticate, checkPassword, validatePassword, hashPassword, createUser, userCount,
};
