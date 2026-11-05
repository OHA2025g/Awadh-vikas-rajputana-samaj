# अवध राजपूत विकास संघ, पुणे — Website & Admin Panel

Hindi community website with a member directory, online membership applications, a community wall, and an admin panel (CMS, member management, WhatsApp broadcasts, and a calibrated certificate printer for pre-printed sheets).

## Quick start

Requires Node.js 20 or newer and PostgreSQL 16 (local Docker is enough).

```bash
docker compose up -d postgres
cp .env.example .env
npm install
npm start
```

Open http://localhost:3000 for the website and http://localhost:3000/admin for the admin panel.

Default login: `admin` / `admin123` — you are asked to change the password on first login. To set your own initial credentials, copy `.env.example` to `.env` and set `ADMIN_USERNAME` / `ADMIN_PASSWORD` **before the first start**.

Production (EasyPanel) starts **without** sample members, donations, events or posts. Add real data from the admin panel. For a local preview with placeholders, set `SEED_DEMO=true` **before the first start**.

## Data and backups

Membership, donations, CMS and settings live in **PostgreSQL**. File uploads stay on disk:

| Path | Contents |
| --- | --- |
| PostgreSQL | Members, donations, meetings, CMS, admin users |
| `data/uploads/` | Public images (photos, gallery, logo) |
| `data/private/` | Applicant and authorised signatures (admin-only) |
| `data/wa-auth/` | WhatsApp QR-gateway session |

Back up the Postgres service (EasyPanel → Postgres → Backups) **and** the `/app/data` volume. Deleting the database resets sample content on next start.

To copy an old local `data/app.db` into Postgres once:

```bash
npm i -D better-sqlite3
DATABASE_URL=postgres://arvs:arvs@localhost:5432/arvs node scripts/migrate-sqlite-to-pg.mjs
```

## Certificate printer (प्रमाण पत्र प्रिंटर)

Admin → **प्रमाण पत्र प्रिंट**.

1. Add the अध्यक्ष / सचिव signature under **अधिकृत हस्ताक्षर** (draw it or upload a scan).
2. Optionally upload a scan of a blank pre-printed sheet (Calibration → डिज़ाइन tab) so the preview matches your paper exactly.
3. Drag the name and signature boxes on the preview, or use the millimetre sliders.
4. Print a **परीक्षण प्रिंट** (test print) on plain paper, lay it over a pre-printed sheet against light, and correct any shift with **प्रिंटर ऑफ़सेट**. Save the calibration.
5. Select members (search, category, mandal, or "not yet printed") and press **प्रिंट करें**.

Browser print settings: Paper **A4**, Margins **None**, Scale **100% / Default** (never "Fit to page"), headers and footers off. Turn on **Background graphics** only when printing the full design on plain paper.

With **प्री-प्रिंटेड पेपर मोड** on, only the member's name and the signature are printed (plus serial number and date if you enable them).

## WhatsApp broadcasts

Admin → **व्हाट्सऐप प्रसारण**.

- **QR gateway (Baileys):** press *कनेक्ट करें* and scan the QR from WhatsApp → Linked devices. Use a dedicated organisation number. This is an unofficial WhatsApp Web client, so keep the volume modest; messages are spaced by a random 4–9 second delay.
- **Meta Cloud API:** a super-admin enters the Phone Number ID and access token. Outside the 24-hour window, Meta requires an approved template with one `{{1}}` body parameter; the personalised message is sent in that parameter.

Sub-admins only ever see masked phone numbers (`+91 98******12`), including in CSV/Excel exports.

## Deployment notes

- Run behind HTTPS (e.g. Nginx + Let's Encrypt / EasyPanel) and set `COOKIE_SECURE=true` and `TRUST_PROXY=1`.
- The QR gateway needs a long-running server (a VPS); it will not work on serverless hosting.

### EasyPanel (App + Postgres)

1. Create a **PostgreSQL** service. Note its user, password, database name and internal hostname.
2. Create an **App** from this repo's `Dockerfile`. Mount a volume on `/app/data` (uploads / WhatsApp only).
3. On the App, set environment variables from the Postgres service — either one URL or split fields:

```
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB_NAME
```

or:

```
DB_HOST=<postgres service host>
DB_PORT=5432
DB_NAME=<database name>
DB_USER=<user>
DB_PASSWORD=<password>
```

`DB_URL` is accepted as an alias of `DATABASE_URL`. You can keep replicas above 1 for the App; keep a single Postgres service.
