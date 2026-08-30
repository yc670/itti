# Running the backend test suite

## One-time setup

```bash
cd server
pip install -r requirements-dev.txt
```

`requirements-dev.txt` pulls in `requirements.txt` plus `pytest` - never
install this file in production (see its own comment for why).

## Running the tests

```bash
cd server
python3 -m pytest
```

Or a single file / test:

```bash
python3 -m pytest tests/test_auth.py
python3 -m pytest tests/test_auth.py::TestLogin::test_login_rate_limited
```

## What this actually tests against

**Never the real `server/app.db`.** `conftest.py` sets `DATABASE_URL` to a
fresh temporary SQLite file *before* `app.py` (or any `models.*` module)
is ever imported - `models/database.py` reads that env var at import
time to build its engine, so this has to happen first or every test
would silently run against whatever database was already configured.
`app.py`'s own startup logic (`if DATABASE_URL.startswith("sqlite") and
not inspect(engine).get_table_names(): Base.metadata.create_all(engine)`)
then creates the full schema against that fresh file automatically - no
separate migration step needed for tests.

This means:
- Tests never touch real data, in local dev or production
- The schema tests run against is always the CURRENT one (every
  `models/*.py` file, as of whatever commit you're on) - not frozen to
  whatever the last-run migration happened to be
- A test run leaves a throwaway temp file behind (`tempfile.mkstemp`) -
  harmless, the OS reclaims temp files eventually, and each pytest
  process gets its own fresh one anyway

## Test isolation within a run

The database itself is **not** reset between individual tests in the
same run - re-creating the schema per-test would be slow, and most
tests don't need isolation from each other's leftover rows. Instead:

- Use the `unique_email` fixture for any test that creates a user -
  it's a per-call UUID-based email, so tests can't collide with each
  other on `User.email`'s unique constraint the way a fixed
  `"test@example.com"` would.
- The rate limiter's in-memory storage **is** reset before every test
  automatically (an `autouse=True` fixture in `conftest.py`) - without
  this, a handful of unrelated tests each calling `/api/auth/signup`
  once would collectively exhaust its 5-per-hour limit well before any
  single test meant to test that limit specifically got to run.

## Fixtures available to every test

Defined in `conftest.py`:

- `client` - a Flask test client (`app.test_client()`)
- `csrf_headers` - fetches a real CSRF token the way a browser would
  and returns `{"X-CSRF-Token": "..."}` to pass to any mutating
  request. Every `client.post/patch/delete(...)` in this codebase needs
  this - `enforce_csrf()` in `app.py` rejects any unsafe method without
  a matching token (see that function's own docstring).
- `unique_email` - a guaranteed-unique `test-<uuid>@example.com` string
- `make_verified_user(email, password="password123", role="basic")` -
  a plain helper function (not a fixture, since it takes an email
  argument) that creates a ready-to-use, already-verified account at a
  given role, for tests where the signup/verification flow itself
  isn't what's being tested

## What's covered so far

- `test_auth.py` - signup (including that it no longer logs in
  immediately), email verification (correct/wrong code, resend,
  cooldown), login (including the unverified-account block and the
  rate limit), Google sign-in and account-linking
- `test_csrf.py` - the double-submit cookie pattern itself: GETs
  exempt, POST without/with wrong/with correct token, the bootstrap
  endpoint, webhook exemption
- `test_deletion_workflow.py` - the full reviewer-role deletion
  request/review flow (instant-delete blocked on published reports,
  reason required, stays public while pending, reviewer queue,
  approve/deny outcomes, self-review blocked, wrong-role blocked) and
  admin's separate instant-delete/repost path
- `test_search.py` - the public reports search endpoint (blank query,
  title match, and that unpublished reports never appear)

## What's NOT covered yet

This is a starting point, not exhaustive coverage of the whole
backend - notably missing: the peer-review publish workflow (approve/
reject voting, resubmission), donations/Stripe, certifications/
enrollment, fellows, country/globe data, file storage (S3 vs local),
and most of the admin Control-tab tooling. Add test files for these
following the same pattern (a `tests/test_<area>.py` file, using the
fixtures above) as they come up for other reasons - e.g. fixing a bug
in one of these areas is a good time to also add a test that would
have caught it.

---

# Running the frontend test suite

## One-time setup

Already installed if you've run `npm install` in `client/` since this
was added - `vitest`, `@testing-library/react`, `@testing-library/
jest-dom`, `@testing-library/user-event`, and `jsdom` are in
`devDependencies`.

## Running the tests

```bash
cd client
npm run test        # runs once and exits (what CI uses)
npm run test:watch  # re-runs on file changes, for active development
```

## Where tests live

- `src/test/utils/` - pure function tests (e.g. `formValidation.js`'s
  `checkEmail`/`checkPassword`/etc.) - no rendering, no mocking, just
  input/output assertions
- `src/test/components/` - component tests using React Testing Library
  (`render`, `screen`, `userEvent`) - test what a user would actually
  see/click, not internal implementation details
- `src/test/setup.js` - global Vitest setup (currently just registers
  `@testing-library/jest-dom`'s matchers like `.toBeInTheDocument()`)

Configured in `vite.config.js`'s `test` block - `environment: "jsdom"`
(so `document`/`window` exist without a real browser), `globals: true`
(so `describe`/`it`/`expect` don't need to be imported in every file,
though the existing test files import them explicitly anyway for
clarity).

## Mocking network calls

Components that call the backend (via `api.js` or a util that itself
calls `api.js`, like `utils/siteSearch.js`) should mock that module
with `vi.mock(...)` rather than letting the test hit a real network
call - see `src/test/components/SiteSearchBar.test.jsx` for the
pattern: mock `siteSearch()` itself, assert the component calls it
correctly and renders whatever it resolves with, rather than also
re-testing the search logic itself (that's what the backend's
`test_search.py` and the module's own logic are for).

## What's NOT covered yet

Only two test files exist so far (`formValidation.test.js`,
`SiteSearchBar.test.jsx`) - a starting point covering one pure-utility
module and one component built this session, not the many other
components/pages in this app (forms, the Observatory globe, admin
Control-tab panels, the whole auth flow's UI, etc.). Same guidance as
the backend section above: add test files following the same
structure as new work touches these areas.
