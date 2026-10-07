const express = require('express');
const { db } = require('../db');
const { verifyCsrf } = require('../auth');
const L = require('../listings');
const { listingUrl } = require('../helpers');
const mailer = require('../mailer');

const router = express.Router();
const PER_PAGE = 12;

router.get('/', (req, res) => {
  const machinery = L.search({ type: 'machinery', statuses: ['available', 'under_offer'], publishedOnly: true, limit: 6 });
  const projects = L.search({
    type: 'project',
    publishedOnly: true,
    statuses: L.TYPES.project.statuses.filter((s) => s !== 'sold'),
    limit: 3,
  });
  const stats = db
    .prepare(
      `SELECT
         SUM(type = 'machinery' AND status IN ('available','under_offer')) AS machines_available,
         SUM(status = 'sold') AS sold,
         SUM(type = 'project' AND status IN ('ongoing','completed')) AS projects_delivered
       FROM listings WHERE published = 1`,
    )
    .get();
  res.render('public/home', { title: null, machinery: machinery.rows, projects: projects.rows, stats });
});

router.get('/about', (req, res) => res.render('public/about', { title: 'About us' }));

router.get('/contact', (req, res) => res.render('public/contact', { title: 'Contact', form: {}, errors: [], listing: null }));

// Enquiry from the contact page or a listing page.
router.post('/contact', verifyCsrf, (req, res) => {
  const form = {
    name: String(req.body.name || '').trim().slice(0, 200),
    email: String(req.body.email || '').trim().slice(0, 200),
    phone: String(req.body.phone || '').trim().slice(0, 50),
    message: String(req.body.message || '').trim().slice(0, 5000),
  };
  const listingId = Number(req.body.listing_id) || null;
  const listing = listingId ? L.findById(listingId) : null;
  const back = listing ? `${listingUrl(listing)}#enquire` : '/contact';

  // Honeypot field: real people leave it empty, bots tend to fill it in.
  if (req.body.website) {
    req.session.flash = { type: 'success', text: 'Thank you, your enquiry has been sent.' };
    return res.redirect(back);
  }

  const errors = [];
  if (!form.name) errors.push('Please enter your name.');
  if (mailer.parseAddresses(form.email)[0] !== form.email) errors.push('Please enter a valid email address.');
  if (form.message.length < 5) errors.push('Please enter a message.');
  if (errors.length) {
    return res.status(400).render('public/contact', { title: 'Contact', form, errors, listing });
  }
  db.prepare('INSERT INTO enquiries (listing_id, name, email, phone, message) VALUES (?, ?, ?, ?, ?)').run(
    listing?.id ?? null, form.name, form.email, form.phone, form.message,
  );
  // Email the company inbox in the background; the enquiry is already saved either way.
  mailer.sendEnquiryNotification(form, listing, listing ? listingUrl(listing) : null);
  req.session.flash = { type: 'success', text: 'Thank you, your enquiry has been sent. We will be in touch shortly.' };
  res.redirect(back);
});

function listRoute(type) {
  return (req, res) => {
    const filters = L.FILTERS[type];
    const filter = filters.find((f) => f.key === req.query.status) || filters[0];
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = String(req.query.q || '').trim().slice(0, 100);
    const category = String(req.query.category || '');
    const { rows, total } = L.search({
      type,
      statuses: filter.statuses,
      publishedOnly: true,
      q,
      category,
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    });
    res.render('public/listings', {
      title: L.TYPES[type].label,
      cfg: L.TYPES[type],
      filters,
      filter,
      listings: rows,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PER_PAGE)),
      q,
      category,
      categories: L.categories(type),
    });
  };
}

function detailRoute(type) {
  return (req, res, next) => {
    const listing = L.findBySlug(type, req.params.slug);
    // Unpublished drafts are visible only to logged-in staff (with a banner).
    if (!listing || (!listing.published && !req.user)) return next();
    const related = L.search({
      type,
      statuses: ['available', 'under_offer'],
      publishedOnly: true,
      category: listing.category || undefined,
      limit: 4,
    }).rows.filter((r) => r.id !== listing.id).slice(0, 3);
    res.render('public/listing', {
      title: listing.title,
      cfg: L.TYPES[type],
      listing,
      images: L.images(listing.id),
      related,
    });
  };
}

router.get('/machinery', listRoute('machinery'));
router.get('/machinery/:slug', detailRoute('machinery'));
router.get('/projects', listRoute('project'));
router.get('/projects/:slug', detailRoute('project'));

module.exports = router;
