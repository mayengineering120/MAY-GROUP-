# MAY Group Website

**MAY Group · Musbah Al Yaqoot**: Engineering | Heavy Equipment | Machinery Trading.

The company website, with a secure staff portal for managing machinery and projects.

## What it does

**Public website**
- **Home page** with your tagline, live stats (machines available, projects delivered, items sold), featured machinery and projects
- **Machinery** listings with *For sale / For rent / Sold / All* filters, search, categories and photo galleries
- **Rentals**: machinery for hire with daily / weekly / monthly rates; machines out on hire show **On rent**
- **Real Estate**: apartments, villas, offices, warehouses and land for sale or rent (monthly/yearly), with
  property type, bedrooms, bathrooms and area; rented properties show **Rented**
- **Projects**: projects *for sale*, plus a portfolio of your *ongoing and completed* work
- **About** and **Contact** pages, built from your company details
- **WhatsApp**: a floating "Chat on WhatsApp" button on every page, and a WhatsApp button on each machine/project that pre-fills the item's name and link
- **Enquiry forms** on every listing and on the Contact page (with spam protection), **emailed to the company inbox**
- **Prices in UAE dirhams and US dollars**: staff enter a price in either currency and the site shows both,
  converted at the official peg (1 US$ = 3.6725 AED), e.g. *AED 250,000 ≈ US$ 68,074*

**Staff portal** (`/staff`)
- Secure logins with two roles:
  - **Staff**: add and edit machinery and projects, upload photos, mark items *sold / under offer / available*, handle enquiries
  - **Administrators**: everything above, plus deleting listings, editing company details and managing staff accounts
- Dashboard with stock counts, open enquiries and recent activity
- Each machine can be offered **for sale, for rent, or both**
- One-click **"Mark sold"** (the sold date is recorded automatically), **"Mark on rent"** and **"Back from rent"**
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

### Option A: one click on Render (recommended)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mayengineering120/MAY-GROUP-)

1. Click the button, then sign up or log in to Render (use "Sign in with GitHub").
2. Render reads `render.yaml` and asks for two values:
   - **SMTP_PASS**: the Gmail App password (see *Receiving enquiries by email*). You can leave it empty and add it later.
   - **SITE_URL**: e.g. `https://may-group-website.onrender.com`, or your own domain later.
3. Click **Apply**. After a few minutes the site is live at `https://may-group-website.onrender.com`.
4. Open `/staff` on the live site straight away and create the administrator account.
5. Optional: add your own domain (e.g. `maygroup.ae`) under the service's **Settings → Custom Domains**.

Cost: Render's *Starter* plan (about US$7/month) plus a 5 GB disk (about US$1–2/month). The disk is required:
it keeps the database and photos safe across updates. Every push to the default branch redeploys the site.

### Option B: Railway (if Render doesn't work for you)

1. Go to https://railway.com, click **Login → Login with GitHub**, and approve access.
2. Click **New Project → Deploy from GitHub repo** and choose **MAY-GROUP-**. Railway builds it using the `Dockerfile`.
3. Add storage for the database and photos: right-click the project canvas (or click **+ Create**) and choose
   **Volume**, attach it to the website service, and set the mount path to **`/var/data`**.
4. Open the service, go to **Settings → Networking → Generate Domain**. That address is your website.
5. Open `<your address>/staff` straight away and create the administrator account.
6. Optional, for enquiry emails: under **Variables** add `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
   `SMTP_USER=musbahalyaqootengineering@gmail.com`, `SMTP_PASS=<app password>` and `SITE_URL=<your address>`.

Cost: Railway's Hobby plan, about US$5/month including normal usage. Every push to the default branch redeploys.

### Option C: any other host
Use the `Dockerfile` (mount a persistent volume at `/var/data`) or run `npm ci && npm start` on any
Node.js 22+ server, behind HTTPS. `SESSION_SECRET` is optional; if it isn't set, one is generated and kept in the data folder.

**Back up** the data folder (database + `uploads/`) regularly. On Render, use the disk's snapshots.

## Making changes later with Claude

- **Day-to-day content** (machines, rentals, projects, photos, phone numbers, opening hours, CEO,
  about text, staff accounts): use the **staff portal** at `/staff`. Changes appear instantly.
- **Design or new features**: open this repository in Claude Code (https://claude.ai/code), select
  `mayengineering120/MAY-GROUP-`, and describe the change in your own words. Claude edits the code, tests it,
  and pushes; Render redeploys automatically within a few minutes. `CLAUDE.md` gives Claude the background.

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
