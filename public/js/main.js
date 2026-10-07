// Mobile menu toggle
document.querySelectorAll('.nav-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const nav = document.getElementById(btn.getAttribute('aria-controls'));
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  });
});

// Photo gallery thumbnails
document.querySelectorAll('[data-gallery]').forEach((gallery) => {
  const main = gallery.querySelector('[data-gallery-main]');
  gallery.querySelectorAll('.thumbs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      main.src = btn.dataset.src;
      gallery.querySelectorAll('.thumbs button').forEach((b) => b.removeAttribute('aria-current'));
      btn.setAttribute('aria-current', 'true');
    });
  });
});

// Confirmation prompts for destructive actions
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-confirm]');
  if (el && !window.confirm(el.dataset.confirm)) event.preventDefault();
});

// Listing form: show sale-price or rental-rate fields to match "Sale or rent"
const offerRadios = document.querySelectorAll('input[name="offer_type"]');
function syncOfferFields() {
  const checked = document.querySelector('input[name="offer_type"]:checked');
  if (!checked) return;
  document.querySelectorAll('[data-offer]').forEach((el) => {
    el.hidden = checked.value !== 'both' && el.dataset.offer !== checked.value;
  });
}
offerRadios.forEach((r) => r.addEventListener('change', syncOfferFields));
syncOfferFields();
