# MAY Group Website

**MAY Group · Musbah Al Yaqoot**: Engineering | Heavy Equipment | Machinery Trading.

The company website, with a secure staff portal for managing machinery and projects.

## What it does

**Public website**
- **Home page** with your tagline, live stats (machines available, projects delivered, items sold), featured machinery and projects
- **Machinery** listings with *Available / Sold / All* filters, search, categories and photo galleries
- **Projects**: projects *for sale*, plus a portfolio of your *ongoing and completed* work
- **About** and **Contact** pages, built from your company details
- **Enquiry forms** on every listing and on the Contact page (with spam protection), **emailed to the company inbox**
- **Prices in UAE dirhams and US dollars**: staff enter a price in either currency and the site shows both,
  converted at the official peg (1 US$ = 3.6725 AED), e.g. *AED 250,000 ≈ US$ 68,074*

**Staff portal** (`/staff`)
- Secure logins with two roles:
  - **Staff**: add and edit machinery and projects, upload photos, mark items *sold / under offer / available*, handle enquiries
  - **Administrators**: everything above, plus deleting listings, editing company details and managing staff accounts
- Dashboard with stock counts, open enquiries and recent activity
- One-click **"Mark sold"** (the sold date is recorded automatically)
- **Draft** listings (unpublished) visible only to staff
- **Internal notes** on each listing (purchase price, seller, buyer…), never shown publicly
- Admins can add staff, reset passwords, promote to admin, or disable access instantly

## Running it

Requires **Node.js 22.13 or newer** (the database is SQLite, built into Node, so there's nothing else to install).

```bash
npm install
npm start
```

Open http://localhost:3000/staff. The first visit asks you to **create the administrator account**.
Then fill in **Company details** and start adding machinery and projects.

Lost the admin password? From the server:

```bash
npm run create-admin -- "Your Name" you@company.com "new-strong-password"
```

## Receiving enquiries by email (Gmail)

Every enquiry is saved in the staff portal **and** emailed to the addresses under
*Staff portal → Company details → Enquiry email notifications*
(default: `musbahalyaqootengineering@gmail.com`). The email's *Reply-To* is the customer,
so pressing **Reply** in Gmail answers them directly.

To switch sending on, Gmail needs an **App password** (Google doesn't allow the normal password):

1. Sign in to the Gmail account and turn on **2-Step Verification** at https://myaccount.google.com/security
2. Go to https://myaccount.google.com/apppasswords, create an app password named "Website", and copy the 16 characters
3. On the server, set:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=musbahalyaqootengineering@gmail.com
   SMTP_PASS=<the 16-character app password>
   SITE_URL=https://www.your-domain.com
   ```
4. Restart the website. *Company details* will show **"Email sending is on"**. Send a test enquiry from the Contact page.

Any other email provider works too, using its SMTP settings.

## Putting it online

It runs on any Node.js host (Render, Railway, Fly.io, a VPS, etc.):

1. Set the environment variables from `.env.example`. **`SESSION_SECRET` is required** in production.
2. Make sure `DATA_DIR` and `UPLOAD_DIR` point to a **persistent disk**: they hold the database and photos.
3. Serve it over **HTTPS** (with `NODE_ENV=production`, login cookies are only sent over HTTPS).
4. **Back up** the `DATA_DIR` and `UPLOAD_DIR` folders regularly.

## Security

- Passwords hashed with bcrypt; minimum 10 characters
- Login throttling, session regeneration on login, 8-hour idle timeout
- CSRF protection on every form, strict Content-Security-Policy, all output escaped
- Photo uploads restricted to JPG/PNG/WebP/GIF, 8 MB each, random filenames
- Disabling a staff account or changing a password signs out that user's other sessions

## Development

```bash
npm run dev   # restarts on file changes
npm test      # end-to-end tests
```

Code layout: `server.js` (app setup), `src/routes/public.js` (website), `src/routes/staff.js` (portal),
`src/listings.js` (machinery/project data), `src/auth.js` (logins & security), `views/` (page templates),
`public/` (CSS & JS).
