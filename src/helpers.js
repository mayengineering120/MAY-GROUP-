// Small formatting helpers available in every template as `h`.

// The UAE dirham is pegged to the US dollar at this fixed official rate.
const AED_PER_USD = 3.6725;
const CURRENCIES = ['AED', 'USD'];
const CURRENCY_LABELS = { AED: 'AED (UAE dirham)', USD: 'USD (US dollar)' };

function money(amount, currency) {
  const n = Number(amount).toLocaleString('en-US', { maximumFractionDigits: currency === 'USD' && amount < 1000 ? 2 : 0 });
  return currency === 'USD' ? `US$ ${n}` : `AED ${n}`;
}

function hasPrice(listing) {
  return listing.status !== 'sold' && !listing.price_on_request && listing.price != null;
}

/** Main price label in the currency the price was entered in, e.g. "AED 250,000". */
function price(listing) {
  if (listing.status === 'sold') return 'Sold';
  if (!hasPrice(listing)) return 'Price on request';
  return money(listing.price, listing.price_currency || 'AED');
}

/** The same price converted to the other currency, e.g. "≈ US$ 68,074", or '' if there is no price. */
function priceAlt(listing) {
  if (!hasPrice(listing)) return '';
  const from = listing.price_currency || 'AED';
  const converted = from === 'AED' ? listing.price / AED_PER_USD : listing.price * AED_PER_USD;
  return `≈ ${money(Math.round(converted), from === 'AED' ? 'USD' : 'AED')}`;
}

function number(n) {
  return n == null ? '' : Number(n).toLocaleString('en-US');
}

function date(value) {
  if (!value) return '';
  // SQLite datetime('now') values are UTC without a zone marker.
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Split text into paragraphs for safe rendering (templates escape each one). */
function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function lines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Split a list of phone numbers (one per line or comma-separated). */
function phones(text) {
  return String(text || '')
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function listingUrl(listing) {
  return `/${listing.type === 'machinery' ? 'machinery' : 'projects'}/${listing.slug}`;
}

function telHref(phone) {
  return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
}

module.exports = {
  AED_PER_USD, CURRENCIES, CURRENCY_LABELS, money, price, priceAlt, number, date, paragraphs, lines, phones, listingUrl, telHref,
};
