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

/** An amount converted to the other currency, e.g. "≈ US$ 68,074". */
function converted(amount, from) {
  const value = from === 'USD' ? amount * AED_PER_USD : amount / AED_PER_USD;
  return `≈ ${money(Math.round(value), from === 'USD' ? 'AED' : 'USD')}`;
}

/** The sale price converted to the other currency, or '' if there is no price. */
function priceAlt(listing) {
  if (!hasPrice(listing)) return '';
  return converted(listing.price, listing.price_currency || 'AED');
}

// Machinery and real estate can be offered for rent as well as for sale.
const RENTABLE = ['machinery', 'property'];

function forSale(listing) {
  return !RENTABLE.includes(listing.type) || listing.offer_type !== 'rent';
}

function forRent(listing) {
  return RENTABLE.includes(listing.type) && (listing.offer_type === 'rent' || listing.offer_type === 'both');
}

/** Rental rates that have been filled in: [{ period: 'day', main: 'AED 1,500', alt: '≈ US$ 408' }, ...] */
function rentRates(listing) {
  const currency = listing.price_currency || 'AED';
  return ['day', 'week', 'month', 'year']
    .map((period) => [`rent_${period}`, period])
    .filter(([key]) => listing[key] != null)
    .map(([key, period]) => ({ period, main: money(listing[key], currency), alt: converted(listing[key], currency) }));
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

/** WhatsApp chat link (wa.me) for a number, optionally with a pre-filled message. */
function whatsappHref(number, text) {
  const digits = String(number || '').replace(/\D/g, '').replace(/^00/, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

const TYPE_PATHS = { machinery: 'machinery', project: 'projects', property: 'real-estate' };

function listingUrl(listing) {
  return `/${TYPE_PATHS[listing.type]}/${listing.slug}`;
}

/** Short facts line for a property card, e.g. "3 bed · 2 bath · 1,850 sq ft". */
function propertyFacts(listing) {
  return [
    listing.bedrooms != null ? (listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} bed`) : null,
    listing.bathrooms != null ? `${listing.bathrooms} bath` : null,
    listing.area != null ? `${number(listing.area)} sq ft` : null,
  ].filter(Boolean);
}

/** Wording for a rent enquiry: machines are hired, property is rented. */
function rentVerb(listing) {
  return listing.type === 'property' ? 'renting' : 'hiring';
}

function telHref(phone) {
  return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
}

module.exports = {
  AED_PER_USD, CURRENCIES, CURRENCY_LABELS, money, price, priceAlt, forSale, forRent, rentRates, number, date, paragraphs, lines, phones, whatsappHref, listingUrl, propertyFacts, rentVerb, telHref,
};
