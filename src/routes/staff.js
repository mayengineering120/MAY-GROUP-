const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, getSettings, saveSettings } = require('../db');
const auth = require('../auth');
const L = require('../listings');

const router = express.Router();
const { verifyCsrf, requireStaff, requireAdmin } = auth;

// ---------- Photo uploads ----------
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: L.UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('Photos must be JPG, PNG, WebP or GIF files.');
    err.status = 400;
    cb(err);
  },
}).array('photos', 20);

function discardUploads(req) {
  (req.files || []).forEach((f) => L.unlinkUpload(f.filename));
}

// CSRF check for multipart forms; runs after multer so the token field is parsed.
function verifyCsrfUpload(req, res, next) {
  verifyCsrf(req, res, (err) => {
    if (err) discardUploads(req);
    next(err);
  });
}

function flash(req, type, text) {
  req.session.flash = { type, text };
}

function notFound() {
  const err = new Error('Not found.');
  err.status = 404;
  return err;
}

router.use((req, res, next) => {
  res.locals.staffArea = true;
  next();
});

// ---------- First-run setup: create the first administrator ----------
router.get('/setup', (req, res) => {
  if (auth.userCount() > 0) return res.redirect('/staff/login');
  res.render('staff/setup', { title: 'Set up', form: {}, errors: [] });
});

router.post('/setup', verifyCsrf, (req, res, next) => {
  if (auth.userCount() > 0) return res.redirect('/staff/login');
  const form = { name: String(req.body.name || '').trim(), email: String(req.body.email || '').trim() };
  const errors = [];
  if (!form.name) errors.push('Name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.push('A valid email is required.');
  const pwErr = auth.validatePassword(req.body.password || '');
  if (pwErr) errors.push(pwErr);
  if (req.body.password !== req.body.password_confirm) errors.push('Passwords do not match.');
  if (errors.length) return res.status(400).render('staff/setup', { title: 'Set up', form, errors });
  const id = auth.createUser({ ...form, password: req.body.password, role: 'admin' });
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = id;
    flash(req, 'success', 'Your administrator account is ready. Start by filling in your company details.');
    res.redirect('/staff/company');
  });
});

// ---------- Login / logout ----------
router.get('/login', (req, res) => {
  if (auth.userCount() === 0) return res.redirect('/staff/setup');
  if (req.user) return res.redirect('/staff');
  res.render('staff/login', { title: 'Staff login', email: '', error: null, next: req.query.next || '' });
});

router.post('/login', verifyCsrf, (req, res, next) => {
  const email = String(req.body.email || '').trim();
  const nextUrl = String(req.body.next || '');
  const safeNext = /^\/staff(\/|$)/.test(nextUrl) && !nextUrl.startsWith('//') ? nextUrl : '/staff';
  const fail = (error) => res.status(401).render('staff/login', { title: 'Staff login', email, error, next: nextUrl });

  if (auth.isThrottled(req, email)) return fail('Too many failed attempts. Please wait 15 minutes and try again.');
  const user = auth.authenticate(email, req.body.password || '');
  if (!user) {
    auth.recordFailure(req, email);
    return fail('Incorrect email or password, or the account is disabled.');
  }
  auth.clearFailures(req, email);
  // New session id on login prevents session fixation.
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    res.redirect(safeNext);
  });
});

router.post('/logout', verifyCsrf, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('may.sid');
    res.redirect('/staff/login');
  });
});

// Everything below requires a logged-in staff member.
router.use(requireStaff);

// ---------- Dashboard ----------
router.get('/', (req, res) => {
  const counts = db
    .prepare(
      `SELECT type,
         SUM(status IN ('available','under_offer')) AS available,
         SUM(status = 'sold') AS sold,
         SUM(published = 0) AS drafts,
         COUNT(*) AS total
       FROM listings GROUP BY type`,
    )
    .all();
  const byType = Object.fromEntries(counts.map((c) => [c.type, c]));
  const openEnquiries = db.prepare('SELECT COUNT(*) AS n FROM enquiries WHERE handled = 0').get().n;
  const enquiries = db
    .prepare(
      `SELECT e.*, l.title AS listing_title, l.type AS listing_type, l.slug AS listing_slug
       FROM enquiries e LEFT JOIN listings l ON l.id = e.listing_id
       WHERE e.handled = 0 ORDER BY e.created_at DESC LIMIT 5`,
    )
    .all();
  const recent = db
    .prepare(
      `SELECT l.*, u.name AS updated_by_name FROM listings l LEFT JOIN users u ON u.id = l.updated_by
       ORDER BY l.updated_at DESC LIMIT 8`,
    )
    .all();
  res.render('staff/dashboard', { title: 'Dashboard', byType, openEnquiries, enquiries, recent });
});

// ---------- Listings (machinery & projects) ----------
for (const cfg of Object.values(L.TYPES)) {
  const base = `/${cfg.path}`;

  const loadListing = (req, res, next) => {
    const listing = L.findById(Number(req.params.id));
    if (!listing || listing.type !== cfg.key) return next(notFound());
    req.listing = listing;
    next();
  };

  const renderForm = (res, listing, errors = [], status = 200) =>
    res.status(status).render('staff/listing-form', {
      title: listing.id ? `Edit ${cfg.singular.toLowerCase()}` : `Add ${cfg.singular.toLowerCase()}`,
      cfg,
      listing,
      images: listing.id ? L.images(listing.id) : [],
      categories: L.categories(cfg.key, false),
      errors,
    });

  router.get(base, (req, res) => {
    const status = cfg.statuses.includes(req.query.status) ? req.query.status : '';
    const q = String(req.query.q || '').trim();
    const { rows, total } = L.search({
      type: cfg.key,
      statuses: status ? [status] : null,
      q,
      limit: 500,
      order: 'updated_at DESC, id DESC',
    });
    res.render('staff/listings', { title: cfg.label, cfg, listings: rows, total, status, q });
  });

  router.get(`${base}/new`, (req, res) => {
    renderForm(res, { type: cfg.key, status: 'available', published: 1 });
  });

  router.post(base, upload, verifyCsrfUpload, (req, res) => {
    const { data, errors } = L.fromForm(cfg.key, req.body);
    if (errors.length) {
      discardUploads(req);
      return renderForm(res, { ...data, type: cfg.key }, errors, 400);
    }
    const id = L.create(cfg.key, data, req.user.id);
    L.addImages(id, (req.files || []).map((f) => f.filename));
    flash(req, 'success', `"${data.title}" was added.`);
    res.redirect(`/staff${base}/${id}/edit`);
  });

  router.get(`${base}/:id/edit`, loadListing, (req, res) => renderForm(res, req.listing));

  router.post(`${base}/:id`, loadListing, upload, verifyCsrfUpload, (req, res) => {
    const { data, errors } = L.fromForm(cfg.key, req.body);
    if (errors.length) {
      discardUploads(req);
      return renderForm(res, { ...req.listing, ...data }, errors, 400);
    }
    L.update(req.listing.id, data, req.user.id);
    L.addImages(req.listing.id, (req.files || []).map((f) => f.filename));
    flash(req, 'success', 'Changes saved.');
    res.redirect(`/staff${base}/${req.listing.id}/edit`);
  });

  // Quick status change, e.g. "Mark as sold" from the list.
  router.post(`${base}/:id/status`, loadListing, verifyCsrf, (req, res) => {
    if (L.setStatus(req.listing.id, req.body.status, req.user.id)) {
      flash(req, 'success', `"${req.listing.title}" marked as ${L.STATUS_LABELS[req.body.status].toLowerCase()}.`);
    }
    res.redirect(req.body.back === 'edit' ? `/staff${base}/${req.listing.id}/edit` : `/staff${base}`);
  });

  router.post(`${base}/:id/images/:imageId/delete`, loadListing, verifyCsrf, (req, res) => {
    L.removeImage(req.listing.id, Number(req.params.imageId));
    flash(req, 'success', 'Photo removed.');
    res.redirect(`/staff${base}/${req.listing.id}/edit#photos`);
  });

  router.post(`${base}/:id/images/:imageId/cover`, loadListing, verifyCsrf, (req, res) => {
    L.makeCover(req.listing.id, Number(req.params.imageId));
    flash(req, 'success', 'Cover photo updated.');
    res.redirect(`/staff${base}/${req.listing.id}/edit#photos`);
  });

  router.post(`${base}/:id/delete`, requireAdmin, loadListing, verifyCsrf, (req, res) => {
    L.remove(req.listing.id);
    flash(req, 'success', `"${req.listing.title}" was deleted.`);
    res.redirect(`/staff${base}`);
  });
}

// ---------- Enquiries ----------
router.get('/enquiries', (req, res) => {
  const show = req.query.show === 'all' ? 'all' : 'open';
  const enquiries = db
    .prepare(
      `SELECT e.*, l.title AS listing_title, l.type AS listing_type, l.slug AS listing_slug, u.name AS handled_by_name
       FROM enquiries e
       LEFT JOIN listings l ON l.id = e.listing_id
       LEFT JOIN users u ON u.id = e.handled_by
       ${show === 'open' ? 'WHERE e.handled = 0' : ''}
       ORDER BY e.created_at DESC LIMIT 500`,
    )
    .all();
  res.render('staff/enquiries', { title: 'Enquiries', enquiries, show });
});

router.post('/enquiries/:id/handled', verifyCsrf, (req, res) => {
  const handled = req.body.handled === '1' ? 1 : 0;
  db.prepare('UPDATE enquiries SET handled = ?, handled_by = ? WHERE id = ?').run(
    handled, handled ? req.user.id : null, Number(req.params.id),
  );
  res.redirect(`/staff/enquiries${req.body.show === 'all' ? '?show=all' : ''}`);
});

router.post('/enquiries/:id/delete', requireAdmin, verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM enquiries WHERE id = ?').run(Number(req.params.id));
  flash(req, 'success', 'Enquiry deleted.');
  res.redirect('/staff/enquiries?show=all');
});

// ---------- My account ----------
router.get('/account', (req, res) => res.render('staff/account', { title: 'My account', errors: [] }));

router.post('/account', verifyCsrf, (req, res) => {
  const errors = [];
  if (!auth.checkPassword(req.user.id, req.body.current_password || '')) {
    errors.push('Your current password is incorrect.');
  }
  const pwErr = auth.validatePassword(req.body.new_password || '');
  if (pwErr) errors.push(pwErr);
  if (req.body.new_password !== req.body.new_password_confirm) errors.push('New passwords do not match.');
  if (errors.length) return res.status(400).render('staff/account', { title: 'My account', errors });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(req.body.new_password), req.user.id);
  // Sign out any other sessions belonging to this user.
  db.prepare("DELETE FROM sessions WHERE sid != ? AND json_extract(data, '$.userId') = ?").run(req.sessionID, req.user.id);
  flash(req, 'success', 'Password changed.');
  res.redirect('/staff/account');
});

// ---------- Admin: company details ----------
router.get('/company', requireAdmin, (req, res) => {
  res.render('staff/company', { title: 'Company details', settings: getSettings() });
});

router.post('/company', requireAdmin, verifyCsrf, (req, res) => {
  saveSettings(req.body);
  flash(req, 'success', 'Company details saved. They now appear across the website.');
  res.redirect('/staff/company');
});

// ---------- Admin: staff accounts ----------
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, active, last_login_at, created_at FROM users ORDER BY active DESC, name').all();
  res.render('staff/users', { title: 'Staff accounts', users, form: {}, errors: [] });
});

router.post('/users', requireAdmin, verifyCsrf, (req, res) => {
  const form = {
    name: String(req.body.name || '').trim(),
    email: String(req.body.email || '').trim(),
    role: req.body.role === 'admin' ? 'admin' : 'staff',
  };
  const errors = [];
  if (!form.name) errors.push('Name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.push('A valid email is required.');
  else if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(form.email)) errors.push('That email already has an account.');
  const pwErr = auth.validatePassword(req.body.password || '');
  if (pwErr) errors.push(pwErr);
  if (errors.length) {
    const users = db.prepare('SELECT id, name, email, role, active, last_login_at, created_at FROM users ORDER BY active DESC, name').all();
    return res.status(400).render('staff/users', { title: 'Staff accounts', users, form, errors });
  }
  auth.createUser({ ...form, password: req.body.password });
  flash(req, 'success', `Account created for ${form.name}. Share the password with them securely.`);
  res.redirect('/staff/users');
});

router.post('/users/:id', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw notFound();
  const action = req.body.action;
  const otherActiveAdmins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(id).n;
  const signOut = () => db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?").run(id);

  if ((action === 'disable' || action === 'make_staff') && target.role === 'admin' && otherActiveAdmins === 0) {
    flash(req, 'error', 'There must always be at least one active administrator.');
  } else if (action === 'disable') {
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    signOut();
    flash(req, 'success', `${target.name}'s access has been disabled.`);
  } else if (action === 'enable') {
    db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(id);
    flash(req, 'success', `${target.name}'s access has been restored.`);
  } else if (action === 'make_admin' || action === 'make_staff') {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(action === 'make_admin' ? 'admin' : 'staff', id);
    flash(req, 'success', `${target.name} is now ${action === 'make_admin' ? 'an administrator' : 'a staff member'}.`);
  } else if (action === 'reset_password') {
    const pwErr = auth.validatePassword(req.body.password || '');
    if (pwErr) flash(req, 'error', pwErr);
    else {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(req.body.password), id);
      if (id !== req.user.id) signOut();
      flash(req, 'success', `Password reset for ${target.name}.`);
    }
  }
  res.redirect('/staff/users');
});

module.exports = router;
