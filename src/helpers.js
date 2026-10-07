// Small formatting helpers available in every template as `h`.

function price(listing, currency) {
  if (listing.status === 'sold') return 'Sold';
  if (listing.price_on_request || listing.price == null) return 'Price on request';
  return `${currency || ''}${Number(listing.price).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}

function number(n) {
  return n == null ? '' : Number(n).toLocaleString('en-GB');
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

function listingUrl(listing) {
  return `/${listing.type === 'machinery' ? 'machinery' : 'projects'}/${listing.slug}`;
}

function telHref(phone) {
  return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
}

module.exports = { price, number, date, paragraphs, lines, listingUrl, telHref };
