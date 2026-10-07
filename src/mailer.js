// Emails new website enquiries to the company inbox.
//
// Configure with environment variables (see README):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, optional SMTP_FROM and SITE_URL.
// For Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=<gmail address>,
// SMTP_PASS=<16-character Google "App password">.
const nodemailer = require('nodemailer');
const { getSettings } = require('./db');

// Captured messages when MAIL_TRANSPORT=json (used by the tests).
const outbox = [];
let transport = null;

function isConfigured() {
  return process.env.MAIL_TRANSPORT === 'json' || Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (transport) return transport;
  if (process.env.MAIL_TRANSPORT === 'json') {
    transport = nodemailer.createTransport({ jsonTransport: true });
  } else {
    const port = Number(process.env.SMTP_PORT) || 465;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

function parseAddresses(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(e));
}

const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const escapeHtml = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Send an enquiry notification. Never throws: failures are logged so the visitor's
 * enquiry is still saved and shown in the staff portal.
 */
async function sendEnquiryNotification(enquiry, listing, listingPath) {
  if (!isConfigured()) return false;
  const settings = getSettings();
  const to = parseAddresses(settings.notify_email || settings.email);
  if (!to.length) return false;

  const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
  const about = listing ? `${listing.title}` : 'General enquiry';
  const rows = [
    ['Name', enquiry.name],
    ['Email', enquiry.email],
    ['Phone', enquiry.phone || '-'],
    ['Regarding', about + (listing && siteUrl ? ` (${siteUrl}${listingPath})` : '')],
  ];
  const staffLink = siteUrl ? `${siteUrl}/staff/enquiries` : '';

  const text = [
    `New enquiry from the ${settings.company_name} website`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Message:',
    enquiry.message,
    '',
    'Reply to this email to answer the customer directly.',
    staffLink ? `Staff portal: ${staffLink}` : '',
  ].join('\n');

  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#16202b">
  <h2 style="color:#0b2f52;margin:0 0 12px">New website enquiry</h2>
  <table cellpadding="6" style="border-collapse:collapse">
    ${rows.map(([k, v]) => `<tr><td style="color:#687684">${k}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join('')}
  </table>
  <p style="margin:16px 0 4px;color:#687684">Message</p>
  <div style="white-space:pre-line;border-left:4px solid #c9a24d;padding:8px 12px;background:#f7f5ef">${escapeHtml(enquiry.message)}</div>
  <p style="color:#687684;font-size:13px">Press <strong>Reply</strong> to answer ${escapeHtml(enquiry.name)} directly.${
    staffLink ? ` Manage enquiries in the <a href="${escapeHtml(staffLink)}">staff portal</a>.` : ''
  }</p>
</div>`;

  try {
    const info = await getTransport().sendMail({
      from: { name: `${oneLine(settings.company_name)} Website`, address: process.env.SMTP_FROM || process.env.SMTP_USER || 'website@localhost' },
      to,
      replyTo: { name: oneLine(enquiry.name), address: enquiry.email },
      subject: oneLine(listing ? `New enquiry: ${listing.title} - from ${enquiry.name}` : `New website enquiry from ${enquiry.name}`),
      text,
      html,
    });
    if (process.env.MAIL_TRANSPORT === 'json') outbox.push(JSON.parse(info.message));
    return true;
  } catch (err) {
    console.error('Failed to send enquiry email:', err.message);
    return false;
  }
}

module.exports = { isConfigured, parseAddresses, sendEnquiryNotification, outbox };
