const path = require('node:path');
const express = require('express');
const { getSettings } = require('./src/db');
const { sessionMiddleware, csrfToken, loadUser } = require('./src/auth');
const { UPLOAD_DIR, STATUS_LABELS, TYPES, OFFER_TYPES } = require('./src/listings');
const helpers = require('./src/helpers');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  });
  next();
});

// Health check for the hosting platform (no session or database work).
app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: false }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(sessionMiddleware());
app.use(loadUser);
app.use(csrfToken);

function setLocals(req, res) {
  res.locals.company = getSettings();
  res.locals.path = req.path;
  res.locals.siteUrl = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res.locals.STATUS_LABELS = STATUS_LABELS;
  res.locals.TYPES = TYPES;
  res.locals.OFFER_TYPES = OFFER_TYPES;
  res.locals.h = helpers;
  res.locals.flash = req.session?.flash || null;
  if (req.session?.flash) delete req.session.flash;
  res.locals.user ??= null;
  res.locals.csrf ??= () => '';
}
app.use((req, res, next) => {
  setLocals(req, res);
  next();
});

app.use('/staff', require('./src/routes/staff'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => {
  res.status(404).render('public/error', { title: 'Page not found', status: 404, message: "We couldn't find that page." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = status < 500 ? err.message : 'Something went wrong. Please try again.';
  if (err.code === 'LIMIT_FILE_SIZE') [status, message] = [400, 'Each photo must be 8 MB or smaller.'];
  if (status >= 500) console.error(err);
  // Errors can happen before the locals middleware ran (e.g. a missing upload).
  if (!res.locals.company) setLocals(req, res);
  res.status(status).render('public/error', { title: 'Error', status, message });
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`MAY Group website running at http://localhost:${PORT}`));
}

module.exports = app;
