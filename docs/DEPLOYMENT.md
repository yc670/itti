# Deploying ITTI to DigitalOcean

This uses **DigitalOcean App Platform**, not a raw Droplet. App Platform builds
your backend from the `server/Dockerfile` already in this repo, builds your
frontend as a static site, and provisions a managed Postgres database for
you — no manual server/nginx/systemd setup, and it auto-redeploys on every
push to your `database` branch.

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

## Step 2 — Create the app

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
5. Click through the remaining screens (region, plan). For the database,
   the spec already requests Postgres 16 — DigitalOcean will show you a
   monthly cost estimate before you confirm
6. Click **Create Resources**

## Step 3 — Wait for the first deploy

DigitalOcean will:
1. Build the backend Docker image (installs `requirements-prod.txt`, runs
   `alembic upgrade head`, starts `gunicorn`)
2. Provision the Postgres database and inject `DATABASE_URL` automatically
   into the backend's environment (this is what `${db.DATABASE_URL}` in the
   spec resolves to — you never type the actual connection string yourself)

The frontend is **not** built here — see "Building and deploying the
frontend" below for how that works instead.

This takes a few minutes the first time. Watch the build logs in the
DigitalOcean dashboard; if the build fails, the logs will show exactly
which step broke.

## Step 4 — Verify it's actually working

Once deployed, DigitalOcean gives you a URL like
`https://itti-website-xxxxx.ondigitalocean.app`. Check:

```bash
curl https://<your-app-url>/api/health
```

Should return `{"status": "ok"}`. Then open the URL in a browser and
confirm the frontend loads and can reach the API (try loading the globe,
or the Reports page).

## Step 5 — Point your real domain at it (optional)

1. In the App Platform dashboard → your app → **Settings** → **Domains**
2. Add your domain (e.g. `itti.org`)
3. DigitalOcean shows you a CNAME or A record to add at your domain
   registrar (wherever you bought the domain — Namecheap, Google Domains,
   etc., not DigitalOcean itself unless you also transferred DNS there)
4. Once DNS propagates (can take a few minutes to a few hours), update
   `CLIENT_ORIGIN` in your app's environment variables to the real domain,
   since the backend's CORS policy is locked to whatever `CLIENT_ORIGIN` is
   set to

## Step 6 — Every future deploy

Because `deploy_on_push: true` is set in the spec, pushing to `database`
automatically triggers a new backend deploy. No manual redeploy step
needed. Database migrations run automatically too, since the
Dockerfile's `CMD` runs `alembic upgrade head` before starting
`gunicorn` on every deploy.

The frontend deploys separately — see below.

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