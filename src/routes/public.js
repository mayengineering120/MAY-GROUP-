const express = require('express');
const { db } = require('../db');
const { verifyCsrf } = require('../auth');
const L = require('../listings');
const { listingUrl } = require('../helpers');
const mailer = require('../mailer');

const router = express.Router();
const PER_PAGE = 12;

router.get('/', (req, res) => {
  const [forSale, forRent] = L.FILTERS.machinery;
  const machinery = L.search({ type: 'machinery', statuses: forSale.statuses, offerTypes: forSale.offerTypes, publishedOnly: true, limit: 6 });
  const rentals = L.search({ type: 'machinery', statuses: forRent.statuses, offerTypes: forRent.offerTypes, publishedOnly: true, limit: 3 });
  const projects = L.search({
    type: 'project',
    publishedOnly: true,
    statuses: L.TYPES.project.statuses.filter((s) => s !== 'sold'),
    limit: 3,
  });
  const stats = db
    .prepare(
      `SELECT
         SUM(type = 'machinery' AND status IN ('available','under_offer') AND offer_type IN ('sale','both')) AS machines_available,
         SUM(type = 'machinery' AND status IN ('available','under_offer','on_rent') AND offer_type IN ('rent','both')) AS machines_for_rent,
         SUM(status = 'sold') AS sold,
         SUM(type = 'project' AND status IN ('ongoing','completed')) AS projects_delivered
       FROM listings WHERE published = 1`,
    )
    .get();
  res.render('public/home', { title: null, machinery: machinery.rows, rentals: rentals.rows, projects: projects.rows, stats });
});

// Search engines: which pages to crawl, and a list of every public page.
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /staff\n\nSitemap: ${res.locals.siteUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const base = res.locals.siteUrl;
  const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const pages = ['/', '/machinery', '/rentals', '/projects', '/about', '/contact'].map((p) => ({ loc: base + p }));
  const listings = db.prepare('SELECT type, slug, updated_at FROM listings WHERE published = 1 ORDER BY updated_at DESC').all();
  for (const l of listings) pages.push({ loc: base + listingUrl(l), lastmod: l.updated_at.slice(0, 10) });
  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      pages.map((p) => `  <url><loc>${xml(p.loc)}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}</url>`).join('\n') +
      '\n</urlset>\n',
  );
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

function listRoute(type, defaultFilter) {
  return (req, res) => {
    const filters = L.FILTERS[type];
    const filter = filters.find((f) => f.key === (req.query.status || defaultFilter)) || filters[0];
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = String(req.query.q || '').trim().slice(0, 100);
    const category = String(req.query.category || '');
    const { rows, total } = L.search({
      type,
      statuses: filter.statuses,
      offerTypes: filter.offerTypes,
      publishedOnly: true,
      q,
      category,
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    });
    res.render('public/listings', {
      title: filter.key === 'rent' ? 'Machinery for rent' : L.TYPES[type].label,
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
router.get('/rentals', listRoute('machinery', 'rent'));
router.get('/machinery/:slug', detailRoute('machinery'));
router.get('/projects', listRoute('project'));
router.get('/projects/:slug', detailRoute('project'));

module.exports = router;
