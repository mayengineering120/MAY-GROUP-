// End-to-end tests: boots the app against a throwaway database and drives it over HTTP.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'may-test-'));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.SESSION_SECRET = 'test-secret';

const app = require('../server');
let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Minimal browser: keeps cookies and extracts CSRF tokens from pages. */
function browser() {
  let cookie = '';
  async function req(url, opts = {}) {
    const res = await fetch(base + url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const body = await res.text();
    return { status: res.status, location: res.headers.get('location'), body };
  }
  return {
    get: (url) => req(url),
    async csrf(url) {
      const page = await req(url);
      return page.body.match(/name="_csrf" value="([^"]+)"/)[1];
    },
    post(url, fields) {
      const body = fields instanceof FormData ? fields : new URLSearchParams(fields);
      return req(url, { method: 'POST', body });
    },
  };
}

const admin = browser();
const staff = browser();
const visitor = browser();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('first run redirects to setup and creates an admin', async () => {
  const login = await admin.get('/staff/login');
  assert.strictEqual(login.location, '/staff/setup');
  const _csrf = await admin.csrf('/staff/setup');
  const res = await admin.post('/staff/setup', {
    _csrf, name: 'Ada Admin', email: 'ada@example.com', password: 'correct-horse-1', password_confirm: 'correct-horse-1',
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual((await admin.get('/staff')).status, 200);
  // Setup is closed once an account exists.
  assert.strictEqual((await visitor.get('/staff/setup')).location, '/staff/login');
});

test('posts without a CSRF token are rejected', async () => {
  const res = await admin.post('/staff/company', { company_name: 'Hacked' });
  assert.strictEqual(res.status, 403);
});

test('admin edits company details shown on the public site', async () => {
  const _csrf = await admin.csrf('/staff/company');
  await admin.post('/staff/company', {
    _csrf, company_name: 'MAY Group', tagline: 'Built to last', about: 'We sell machines.', services: 'Sales',
    phone: '+44 1234 567890', email: 'info@may.example', address: '1 Yard Lane', hours: '9-5', currency: '£', registration: '',
  });
  const about = await visitor.get('/about');
  assert.match(about.body, /We sell machines\./);
  assert.match(about.body, /info@may\.example/);
});

test('admin creates a staff account; staff can log in but not access admin pages', async () => {
  const _csrf = await admin.csrf('/staff/users');
  const res = await admin.post('/staff/users', { _csrf, name: 'Sam Staff', email: 'sam@example.com', password: 'staff-pass-123', role: 'staff' });
  assert.strictEqual(res.status, 302);

  const bad = await staff.post('/staff/login', { _csrf: await staff.csrf('/staff/login'), email: 'sam@example.com', password: 'wrong' });
  assert.strictEqual(bad.status, 401);
  const ok = await staff.post('/staff/login', { _csrf: await staff.csrf('/staff/login'), email: 'sam@example.com', password: 'staff-pass-123' });
  assert.strictEqual(ok.location, '/staff');
  assert.strictEqual((await staff.get('/staff/users')).status, 403);
  assert.strictEqual((await staff.get('/staff/company')).status, 403);
});

let machineId;
test('staff adds machinery with a photo; it appears publicly, escaped', async () => {
  const fd = new FormData();
  fd.append('_csrf', await staff.csrf('/staff/machinery/new'));
  fd.append('title', 'CAT 320 <script>alert(1)</script>');
  fd.append('category', 'Excavators');
  fd.append('status', 'available');
  fd.append('price', '45,000');
  fd.append('year', '2019');
  fd.append('hours', '5200');
  fd.append('internal_notes', 'Bought for 30k - secret');
  fd.append('published', '1');
  fd.append('photos', new Blob([PNG], { type: 'image/png' }), 'digger.png');
  const res = await staff.post('/staff/machinery', fd);
  assert.strictEqual(res.status, 302);
  machineId = Number(res.location.match(/\/(\d+)\/edit/)[1]);

  const list = await visitor.get('/machinery');
  assert.match(list.body, /CAT 320 &lt;script&gt;/);
  assert.doesNotMatch(list.body, /<script>alert/);
  assert.match(list.body, /£45,000/);
  const img = list.body.match(/\/uploads\/([\w-]+\.png)/)[1];
  assert.strictEqual((await visitor.get(`/uploads/${img}`)).status, 200);

  const detail = await visitor.get('/machinery/cat-320-script-alert-1-script');
  assert.strictEqual(detail.status, 200);
  assert.doesNotMatch(detail.body, /secret/, 'internal notes must never be public');
});

test('rejects non-image uploads', async () => {
  const fd = new FormData();
  fd.append('_csrf', await staff.csrf('/staff/machinery/new'));
  fd.append('title', 'Bad upload');
  fd.append('photos', new Blob(['<html>'], { type: 'text/html' }), 'x.html');
  const res = await staff.post('/staff/machinery', fd);
  assert.strictEqual(res.status, 400);
});

test('marking as sold moves it to the Sold filter', async () => {
  const _csrf = await staff.csrf('/staff/machinery');
  await staff.post(`/staff/machinery/${machineId}/status`, { _csrf, status: 'sold' });
  const available = await visitor.get('/machinery');
  assert.doesNotMatch(available.body, /CAT 320/);
  const sold = await visitor.get('/machinery?status=sold');
  assert.match(sold.body, /CAT 320/);
  assert.match(sold.body, /badge-sold/);
});

test('drafts are hidden from the public', async () => {
  const fd = new FormData();
  fd.append('_csrf', await staff.csrf('/staff/projects/new'));
  fd.append('title', 'Secret Riverside Project');
  fd.append('status', 'completed');
  const res = await staff.post('/staff/projects', fd);
  assert.strictEqual(res.status, 302);
  assert.doesNotMatch((await visitor.get('/projects?status=all')).body, /Secret Riverside/);
  assert.strictEqual((await visitor.get('/projects/secret-riverside-project')).status, 404);
  assert.strictEqual((await staff.get('/projects/secret-riverside-project')).status, 200);
});

test('visitor enquiries reach the staff inbox', async () => {
  const _csrf = await visitor.csrf('/contact');
  const res = await visitor.post('/contact', { _csrf, name: 'Bob Buyer', email: 'bob@example.com', message: 'Do you have dumpers?' });
  assert.strictEqual(res.status, 302);
  const inbox = await staff.get('/staff/enquiries');
  assert.match(inbox.body, /Bob Buyer/);
  assert.match(inbox.body, /Do you have dumpers\?/);
});

test('only admins can delete listings', async () => {
  const _csrf = await staff.csrf('/staff/machinery');
  assert.strictEqual((await staff.post(`/staff/machinery/${machineId}/delete`, { _csrf })).status, 403);
  const adminCsrf = await admin.csrf('/staff/machinery');
  assert.strictEqual((await admin.post(`/staff/machinery/${machineId}/delete`, { _csrf: adminCsrf })).status, 302);
  assert.strictEqual((await visitor.get('/machinery/cat-320-script-alert-1-script')).status, 404);
});

test('disabling a staff account logs them out immediately', async () => {
  const _csrf = await admin.csrf('/staff/users');
  const samId = 2; // second account created in this fresh database
  await admin.post(`/staff/users/${samId}`, { _csrf, action: 'disable' });
  const res = await staff.get('/staff');
  assert.match(res.location, /\/staff\/login/);
});
