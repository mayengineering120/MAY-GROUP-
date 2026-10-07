# MAY Group website: notes for Claude

Company website for **MAY Group (Musbah Al Yaqoot)**: Engineering | Heavy Equipment | Machinery Trading.
The owner asks for changes in plain language (often non-technical). Make the change, run the tests,
commit, and push to the deployment branch (the repo's default branch); the live site redeploys automatically.

## Stack
- Node.js ≥ 22.13, Express 5, EJS templates, SQLite via built-in `node:sqlite` (no native deps)
- `server.js`: app setup, security headers, error pages, `/healthz`
- `src/db.js`: schema, **migrations** (`addColumn`), default company settings
- `src/listings.js`: machinery/project model: statuses, sale/rent offer types, public filter tabs
- `src/helpers.js`: template helpers (`h.*`): AED/USD prices (fixed peg 3.6725), rent rates, phones
- `src/routes/public.js`: public pages; `src/routes/staff.js`: staff portal (`/staff`)
- `src/auth.js`: sessions (SQLite store), CSRF (`csrf()` in forms + `verifyCsrf`), roles, login throttle
- `src/mailer.js`: enquiry emails via SMTP (Gmail app password)
- `views/`: `public/`, `staff/`, `partials/`; `public/css/style.css` (brand tokens in `:root`)
- Brand: navy `#0b2f52` / `#0d4a80`, gold `#c9a24d`; logo files in `public/img/`

## Content vs code (important)
Company details (name, phones, hours, CEO, about text, email addresses), listings, photos, enquiries and
staff accounts live in the **database on the server**, edited through the staff portal.
Changing `DEFAULT_SETTINGS` in `src/db.js` only affects brand-new installs, **not the live site**.
When the owner asks to change such content, tell them where to change it in the staff portal
(Company details / Machinery / Projects / Staff accounts), or, if they want it done in code, add a
one-off migration in `src/db.js` that updates the setting.

## Rules
- Every form POST needs `<input type="hidden" name="_csrf" value="<%= csrf() %>">` and `verifyCsrf`
  (multipart forms: `upload, verifyCsrfUpload`).
- Escape output with `<%= %>`; only use `<%- %>` for `include()` or trusted static markup.
- Never show `internal_notes` on public pages.
- Schema changes: add the column to `CREATE TABLE` **and** an `addColumn(...)` migration.
- No inline `<script>` or `style=""`: the Content-Security-Policy blocks them; put JS in `public/js/main.js`.

## Checks before pushing
```bash
npm install
npm test        # end-to-end tests in test/app.test.js; add tests for new behaviour
```
To look at pages: `npm start`, open http://localhost:3000 (first visit to /staff creates an admin).

## Deployment
Render blueprint in `render.yaml` (web service + persistent disk at `/var/data`, auto-deploy on push).
Alternative: Railway (`railway.json` + `Dockerfile`, volume at `/var/data`). Secrets (`SESSION_SECRET`, `SMTP_PASS`)
are set in the host dashboard; never commit them. Without `SESSION_SECRET` a secret is generated into `DATA_DIR`.
This repository is public.
