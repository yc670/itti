# Deploying ITTI to DigitalOcean

This uses **DigitalOcean App Platform**, not a raw Droplet. App Platform builds
your backend from the `server/Dockerfile` already in this repo and builds your
frontend as a static site — no manual server/nginx/systemd setup, and it
auto-redeploys on every push to your `database` branch.

The database is a separate step (Step 2 below) and deliberately NOT the
"dev database" App Platform will offer to create automatically if you skip
that step - a dev database has **no backup support at all** (see "Database
backups" further down for why this matters and what to do instead).

If you'd rather manage your own Ubuntu server (more control, more to
maintain — nginx, systemd, SSL certs, OS patching all become your job),
that's a Droplet instead of App Platform; this guide doesn't cover that path.

## Prerequisites

- Your code pushed to a GitHub repo DigitalOcean can access
- A DigitalOcean account with billing set up
- A domain name, if you want `itti.org` instead of the auto-generated
  `*.ondigitalocean.app` URL (optional)
- Brevo API credentials (see the separate section below — get these first,
  since you'll need them during setup)

## Step 1 — Push the two new files this guide depends on

Two files were added to make this deployable:
- `server/Dockerfile` — builds the backend container
- `app.yaml` — the full App Platform spec (services, env vars, database)

Commit and push both to your `database` branch before continuing.

## Step 2 — Create the database cluster (before the app, not through it)

Do this now, separately from creating the app in Step 3 - `app.yaml`'s
`cluster_name` placeholder needs a real cluster to point at, and the app
spec won't create one for you (see "Database backups" further down for
why this order matters).

1. In DigitalOcean → **Databases** (left sidebar) → **Create Database Cluster**
2. Choose **PostgreSQL**, version **16** (matching `app.yaml`)
3. Pick a plan — the smallest available is fine to start; you can resize later
   without downtime
4. Pick the same region you'll deploy the app to (App Platform and the
   database don't need to be in the same region, but it's faster and
   avoids a cross-region data-transfer cost if they are)
5. Give it a name — this is the value that goes in `app.yaml`'s
   `cluster_name` field. Whatever you pick, use the exact same string in
   both the DigitalOcean UI and the spec
6. Click **Create Database Cluster** and wait for it to finish provisioning
   (a few minutes)
7. Once created, go to the cluster's **Settings** tab and confirm
   **Automatic backups** — this should already be on by default for a new
   Managed Database, but it's worth checking now while you're here rather
   than discovering it was off after you actually need a restore. See
   "Database backups" below for what this actually gives you and how to
   restore from one.

## Step 3 — Create the app

1. Log into DigitalOcean → **Apps** (left sidebar) → **Create App**
2. Choose **GitHub** as the source, authorize DigitalOcean to access your
   repo if you haven't already, and select your repo + the `database` branch
3. DigitalOcean will try to auto-detect your services. Instead, click
   **Edit Your App Spec** (usually a link near the bottom) and paste in the
   contents of `app.yaml` from this repo — this defines both services and
   the database in one step rather than clicking through the UI blind
4. Before continuing, replace every `<PLACEHOLDER>` in the spec:
   - `<your-github-username>/itti_website` → your actual repo path (both
     places it appears)
   - `FLASK_SECRET_KEY` → generate one locally:
     ```bash
     python3 -c "import secrets; print(secrets.token_hex(32))"
     ```
   - `GOOGLE_CLIENT_ID` → your existing Google OAuth client ID (same value
     in both the backend and frontend sections — the frontend needs it to
     render the Google Sign-In button, the backend needs it to verify
     tokens)
   - `BREVO_API_KEY`, `BREVO_FROM_EMAIL` → from Brevo, see below
     (`BREVO_FROM_NAME` already has a sensible default, no need to touch it)
   - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` → only if you're using
     the donations feature; delete those two lines entirely if not
   - `cluster_name` under `databases:` → the exact name you gave the
     database cluster you created in Step 2 - **do not skip this**; without
     it, DigitalOcean silently creates a new, separate "dev database"
     instead of connecting to the one you just made, and dev databases
     can't be backed up at all (see "Database backups" below)
5. Click through the remaining screens (region, plan). Since `cluster_name`
   is set, DigitalOcean will connect the app to your existing cluster from
   Step 2 rather than offering to create a new database here
6. Click **Create Resources**

## Step 4 — Wait for the first deploy

DigitalOcean will:
1. Build the backend Docker image (installs `requirements-prod.txt`, runs
   `alembic upgrade head`, starts `gunicorn`)
2. Connect to the database cluster you created in Step 2 and inject
   `DATABASE_URL` automatically into the backend's environment (this is
   what `${db.DATABASE_URL}` in the spec resolves to — you never type the
   actual connection string yourself)

The frontend is **not** built here — see "Building and deploying the
frontend" below for how that works instead.

This takes a few minutes the first time. Watch the build logs in the
DigitalOcean dashboard; if the build fails, the logs will show exactly
which step broke.

## Step 5 — Verify it's actually working

Once deployed, DigitalOcean gives you a URL like
`https://itti-website-xxxxx.ondigitalocean.app`. Check:

```bash
curl https://<your-app-url>/api/health
```

Should return `{"status": "ok"}`. Then open the URL in a browser and
confirm the frontend loads and can reach the API (try loading the globe,
or the Reports page).

## Step 6 — Point your real domain at it (optional)

1. In the App Platform dashboard → your app → **Settings** → **Domains**
2. Add your domain (e.g. `itti.org`)
3. DigitalOcean shows you a CNAME or A record to add at your domain
   registrar (wherever you bought the domain — Namecheap, Google Domains,
   etc., not DigitalOcean itself unless you also transferred DNS there)
4. Once DNS propagates (can take a few minutes to a few hours), update
   `CLIENT_ORIGIN` in your app's environment variables to the real domain,
   since the backend's CORS policy is locked to whatever `CLIENT_ORIGIN` is
   set to

## Step 7 — Every future deploy

Because `deploy_on_push: true` is set in the spec, pushing to `database`
automatically triggers a new backend deploy. No manual redeploy step
needed. Database migrations run automatically too, since the
Dockerfile's `CMD` runs `alembic upgrade head` before starting
`gunicorn` on every deploy.

The frontend deploys separately — see below.

---

# Database backups

**This only works if you followed Step 2 above** and the app is connected
to a real Managed Database cluster (`cluster_name` set in `app.yaml`) — a
"dev database" (what you get if `cluster_name` is missing or blank) cannot
be backed up at all. There is no workaround for a dev database beyond
switching to a Managed Database; DigitalOcean doesn't offer any backup
mechanism for dev databases, automated or manual, through the platform
itself.

## Confirm backups are actually on

1. DigitalOcean → **Databases** → your cluster → **Settings** tab
2. Look for **Automatic backups** — this defaults to on for a new Managed
   Database, but confirm it here rather than assuming. If somehow off,
   enable it
3. Note the retention window shown — DigitalOcean's managed Postgres
   backups are daily, with **7 days of retention** by default (not
   configurable to a longer window through the standard managed-database
   product; see "Extra retention or offsite copies" below if 7 days isn't
   enough for your risk tolerance)

## What this actually protects you from

Automated backups + point-in-time recovery (both included, no extra
setup) mean you can restore the database to any moment within the last 7
days — not just to whenever last night's backup happened to run. This
covers:
- Accidental data loss (a bad manual query, a bug that deletes more than
  intended)
- A broken migration - see `server/fix_reports_schema.py` in this repo
  for the kind of one-off repair script this project has already needed
  once; a restore is the fallback if a future repair script goes wrong
  instead of fixing things
- The underlying database instance failing outright

It does **not** protect against:
- A breach of your DigitalOcean account itself (the backups live inside
  DigitalOcean, on the same platform as the primary - see "Extra
  retention or offsite copies" below if this is a real concern for you)
- Data corruption that isn't caught for more than 7 days after it happens
  (by the time you notice, the good backup has rolled off the retention
  window)

## How to actually restore from one

1. DigitalOcean → **Databases** → your cluster → **Backups** tab (exact
   tab name/location can shift slightly between DigitalOcean UI versions -
   look for "Backups" or "Restore" near the cluster's overview)
2. Choose either a specific daily backup, or a precise point in time
   within the retention window (point-in-time recovery)
3. **Restoring creates a NEW database cluster** with the recovered data -
   it does not overwrite your existing live cluster in place. After the
   restore finishes, you'd update `cluster_name` in `app.yaml` (and
   redeploy) to point the app at the new cluster, or manually migrate the
   data from the restored cluster back into the original one, depending
   on the situation
4. **Test this before you actually need it.** An unverified backup
   strategy is not a backup strategy - restore into a throwaway cluster
   at least once so you know the process actually works and roughly how
   long it takes, rather than discovering a problem with it during an
   actual incident

## Extra retention or offsite copies (optional, beyond the built-in 7 days)

If 7-day retention isn't enough, or you want a copy that doesn't live
inside DigitalOcean at all, add your own periodic `pg_dump` on top of the
built-in backups rather than replacing them:

```bash
# Run this from anywhere with network access to the database and the
# `DATABASE_URL` value (DigitalOcean → your cluster → Connection Details) -
# a local machine via cron, a scheduled GitHub Action, or a small
# always-on box are all reasonable places to run this from.
pg_dump "$DATABASE_URL" | gzip > "itti-backup-$(date +%Y%m%d-%H%M%S).sql.gz"
```

Upload the resulting file to DigitalOcean Spaces (the same bucket
mechanism already used for uploads/frontend elsewhere in this guide, or a
separate one) or any other offsite storage - the point is a copy that
survives even if your entire DigitalOcean account became inaccessible.
This is a genuine addition on top of the built-in backups, not a
replacement for them - it's slower to restore from (a plain SQL dump, not
a live cluster you can point traffic at directly) and won't give you
point-in-time recovery on its own, but covers the offsite-copy and
longer-retention gaps the built-in 7-day window doesn't.

---

# Building and deploying the frontend

The frontend is deliberately **not** built by App Platform's own
static-site build step, and `npm run build` never runs on the backend's
`basic-xxs` instance either — a production Vite build needs more memory
than that instance size comfortably has to spare alongside a running
Flask app. Instead, `client/` is built on GitHub's own runners
(`.github/workflows/deploy-frontend.yml`) and the resulting `dist/`
folder is synced straight to a DigitalOcean Spaces bucket fronted by
DO's CDN, which serves it directly — no build step happens anywhere
near the app's own compute at all.

## One-time setup

1. **Create a Spaces bucket**: DigitalOcean dashboard → **Spaces
   Object Storage** → **Create a Spaces Bucket**. Pick a region (e.g.
   `nyc3`) and a bucket name (e.g. `itti-frontend`). Enable the
   **CDN** option when creating it, or add one afterward under the
   bucket's **Settings** tab — note the CDN endpoint's ID from the URL
   or the API (`doctl compute cdn list`), you'll need it below.
2. **Set the bucket's file listing to restrict** (Settings → File
   Listing → Restrict File Listing), and set **CORS** if you'll ever
   fetch fonts/assets cross-origin from another domain — not needed if
   the frontend is served from its own subdomain that matches
   `CLIENT_ORIGIN`.
3. **Generate Spaces access keys**: dashboard → **API** → **Spaces
   Keys** → **Generate New Key**. This gives you a key/secret pair
   (S3-compatible credentials — Spaces speaks the S3 API).
4. **Generate a DigitalOcean API token** (separate from the Spaces
   keys): dashboard → **API** → **Tokens** → **Generate New Token**,
   with read/write scope. This is only used to trigger a CDN cache
   purge after each deploy, so new deploys aren't served from a stale
   CDN cache.
5. **Add repo secrets** (GitHub repo → **Settings** → **Secrets and
   variables** → **Actions**):
   | Secret | Value |
   |---|---|
   | `DO_SPACES_KEY` | Spaces access key from step 3 |
   | `DO_SPACES_SECRET` | Spaces secret key from step 3 |
   | `DO_SPACES_BUCKET` | Your bucket name, e.g. `itti-frontend` |
   | `DO_SPACES_REGION` | Your bucket's region, e.g. `nyc3` |
   | `DO_API_TOKEN` | API token from step 4 |
   | `DO_CDN_ENDPOINT_ID` | Your CDN endpoint's ID |
   | `GOOGLE_CLIENT_ID` | Same Google OAuth client ID used elsewhere |
6. **Point your domain (or a subdomain) at the CDN endpoint** the same
   way you would for the app itself — DigitalOcean shows the CNAME
   target on the bucket's CDN settings page.
7. **Update `CLIENT_ORIGIN`** in the backend service's env vars (in
   `app.yaml` or the dashboard) to whatever domain now serves the
   frontend, since CORS is locked to that value.

## Every future frontend deploy

Push to `database` with changes under `client/` and
`.github/workflows/deploy-frontend.yml` runs automatically: installs
dependencies, runs `npm run build`, syncs `dist/` to the Spaces
bucket, and purges the CDN cache so the new build is served
immediately rather than after the CDN's normal cache expiry. You can
also trigger it manually from the **Actions** tab (`workflow_dispatch`).

Nothing about this requires touching the backend's `basic-xxs`
instance, and nothing about it counts against App Platform's own build
minutes — the whole build happens on GitHub's free runners.

---

# Persistent storage for uploads (fellow photos, report files/images)

**This step is required, not optional, if the site will ever have
fellow photos or reports uploaded through the live admin/publisher UI.**

By default (`STORAGE_BACKEND` unset, or `local`), uploaded files are
written to disk inside the backend's own container
(`server/fellow_uploads/`, `server/report_uploads/`,
`server/uploads/`). That's fine for local development, but App
Platform rebuilds this service's container from a fresh image on
every deploy — and `app.yaml` sets `deploy_on_push: true`, so that
happens on every single push to `database`, not just occasionally.
Anything written to local disk after the container started (i.e.
every photo/file uploaded through the live site, as opposed to one
that happened to already be committed to the repo and baked into the
image) is gone the moment the container is rebuilt, while the
database row referencing it is untouched.

The visible symptom is a fellow's photo (or a report's file/cover
image) failing to load. Depending on the app version, this shows up
either as a broken image with a clean 404, or — before
`storage.py`'s `get_file_response()` was hardened to catch this — a
raw `{"error": "internal server error"}` from `GET
/api/fellows/<id>/photo` and the equivalent report routes, since
Flask's `send_file()` raises a bare `FileNotFoundError` for a missing
file rather than a handled 404.

The fix is the same one already used for the frontend above: point
uploads at an S3-compatible bucket instead of local disk. `storage.py`
already supports this — it's an env var flip, no code changes needed.

## One-time setup

1. **Create a second Spaces bucket**, separate from the frontend one:
   dashboard → **Spaces Object Storage** → **Create a Spaces Bucket**
   (e.g. `itti-uploads`, same or different region as the frontend
   bucket — doesn't need to match). Leave the CDN option off; this
   bucket doesn't need to be public, since `get_file_response()` serves
   files through short-lived presigned URLs regardless of the bucket's
   own visibility settings.
2. **Reuse or generate Spaces access keys**: the same key/secret pair
   from the frontend setup works here too (Spaces keys aren't scoped to
   one bucket), or generate a separate pair under **API** → **Spaces
   Keys** if you'd rather keep them independent.
3. **Set these env vars on the backend service** (in `app.yaml` or the
   dashboard — `app.yaml` in this repo already has the keys, just fill
   in the placeholders):
   | Env var | Value |
   |---|---|
   | `STORAGE_BACKEND` | `s3` |
   | `STORAGE_S3_BUCKET` | Your bucket name, e.g. `itti-uploads` |
   | `STORAGE_S3_ENDPOINT_URL` | Your region's Spaces endpoint, e.g. `https://nyc3.digitaloceanspaces.com` |
   | `AWS_ACCESS_KEY_ID` | Spaces access key from step 2 |
   | `AWS_SECRET_ACCESS_KEY` | Spaces secret key from step 2 |

   (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are boto3's standard
   credential env vars — used here because Spaces speaks the S3 API,
   not because anything AWS-specific is involved.)
4. **Redeploy** the backend service so the new env vars take effect.

## If you already deployed without this and have broken images now

Any fellow/report uploaded through the live site before switching to
`STORAGE_BACKEND=s3` is already gone from local disk and can't be
recovered from the running container — there's nothing to migrate.
After completing the setup above, re-upload the affected fellow
photos (Profile → Control → Fellows) or report cover images; new
uploads go straight to the bucket and will survive future deploys.

Separately, `server/migrate_absolute_storage_paths.py` fixes a
different, one-time issue some existing rows may have: a photo/file
path baked in as an absolute, machine-specific path (e.g. from
whoever ran an upload locally) rather than the portable relative path
`storage.py` produces today. Safe to run against production any time
— see the script's own docstring.

---

# Setting up your sending address (Brevo)

This is the "what email address do you actually send from" question. You
don't need a new email inbox somewhere — you need Brevo to be *allowed* to
send mail that claims to be from your chosen address, which means proving
you own that email address or its domain.

## Option A — Verify a single email address (fastest, works today)

Use this if you don't have your own domain, or just want to get started
quickly (e.g. `youraccount@gmail.com`, or an address at a domain you don't
control the DNS for).

1. In Brevo: account name (top right) → **Senders, Domains & Dedicated
   IPs** → **Senders** tab
2. Click **Add a Sender**
3. Enter the email address you want to send from and a display name (e.g.
   "ITTI" as the name, `notifications@yourpersonalemail.com` as the
   address)
4. Brevo sends a verification email to that address — click the link in it
5. Once verified, that address can be used as `BREVO_FROM_EMAIL`

**Limitation:** deliverability is weaker with single-sender verification
than full domain verification (more likely to land in spam), and you can
only send *from that exact address*, not any address at a domain.

## Option B — Verify your whole domain (better, needed for `noreply@itti.org`-style addresses)

Use this if you own a domain (e.g. `itti.org`) and want to send from any
address at it (`noreply@itti.org`, `hello@itti.org`, etc.) with good
deliverability.

1. In Brevo: **Senders, Domains & Dedicated IPs** → **Domains** tab
2. Click **Add a domain**, enter your domain (e.g. `itti.org`)
3. Brevo shows you 3–4 DNS records to add — typically:
   - A **DKIM** record (proves emails claiming to be from your domain
     really came from Brevo)
   - A **SPF** record (or an addition to your existing one — a domain can
     only have one SPF record, so if you already send email from this
     domain elsewhere, e.g. Google Workspace, you need to merge Brevo's
     SPF entry into your existing record rather than adding a second one)
   - Sometimes a **DMARC** record recommendation
4. Add these records at your domain registrar's DNS settings (same place
   you'd add the CNAME from Step 5 above, if you're using a custom domain
   for the site too)
5. Back in Brevo, click **Verify** (DNS changes can take anywhere from a
   few minutes to ~24 hours to propagate — if verification fails
   immediately, wait and retry rather than assuming something's wrong)
6. Once verified, you can send from **any address** `@yourdomain.org`
   without verifying each one individually — set `BREVO_FROM_EMAIL` to
   whichever address you want (e.g. `noreply@itti.org`)

## After either option: get your API key

Once your sender/domain is verified, get the actual credential:

1. Account name (top right) → **SMTP & API** → **API Keys** tab
2. Click **Generate a new API key**, give it a name (e.g. "ITTI website"),
   and copy it immediately — it's shown once
3. You now have everything for the three Brevo environment variables used
   in `app.yaml` / `.env`:
   ```
   BREVO_API_KEY=<the key from step 2>
   BREVO_FROM_EMAIL=<the address you verified in Option A or B>
   BREVO_FROM_NAME=International Truth & Trauma Institute
   ```
   (`BREVO_FROM_NAME` is just the display name recipients see, e.g. "ITTI
   <noreply@itti.org>" — change it to whatever you'd like shown.)

**Using SMTP instead:** Brevo also offers an SMTP relay
(`smtp-relay.brevo.com:587`) if you'd rather use `EMAIL_BACKEND=smtp` — the
Login/SMTP key for that live under the same **SMTP & API** page's **SMTP**
tab. The API key above is unrelated to and not interchangeable with the
SMTP login/key; the API approach (`EMAIL_BACKEND=brevo_api`) is what
`app.yaml` uses by default and is recommended since Brevo's API returns a
clear error (bad key, unverified sender, etc.) instead of a generic SMTP
failure.

## Testing it actually works

After deploying with a real `BREVO_API_KEY` and `BREVO_FROM_EMAIL`, confirm
`EMAIL_BACKEND` is actually set to `brevo_api` in the deployed environment
(not left on the `console` default, which logs the email instead of sending
it — this is the most common reason "I never got the email" happens even
though everything else is configured correctly) — check the app's env vars
in the DigitalOcean dashboard if unsure. Then trigger the password-reset
flow (`POST /api/auth/forgot-password` with a real account's email, or just
click "Forgot password" on the login page) and confirm the email actually
arrives — check spam the first few times while your domain builds sending
reputation, especially if you just set up domain verification.