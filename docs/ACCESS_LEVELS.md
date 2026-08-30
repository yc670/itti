# Access levels — how they work and how to extend them

## Identity vs. access tier — two separate things

- **Identity** comes from either Google Sign-In (`POST /api/auth/google`)
  or email/password (`POST /api/auth/signup` + `POST /api/auth/login`).
  If someone signs in with Google using an email that already has a
  password account, the accounts are linked (same `User` row) rather than
  creating a duplicate.
- **Access tier** is `User.role`, independent of both how someone
  authenticated and `User.status` (which just tracks soft-deleted
  accounts, unrelated to permissions).

## The four tiers today

| Role        | Granted how                                     | Can do                                       |
|-------------|----------------------------------------------------|------------------------------------------------|
| `basic`     | Automatically, on every signup/first Google sign-in | Browse the site, view their own documents/events |
| `publisher` | Manually, by an admin (`promote_user.py`)           | Everything `basic` can, plus upload/soft-delete documents and reports (a *published* report's deletion goes through a review request instead - see below) |
| `reviewer`  | Manually, by an admin (`promote_user.py`)           | Everything `publisher` can, plus deciding a publisher's request to delete their own published report |
| `admin`     | Manually, by another admin (`promote_user.py`)      | Everything `reviewer` can, plus permanently (hard) delete documents/reports, and instantly delete any report (published or not) without going through review |

`server/models/user.py` defines `ROLE_BASIC`, `ROLE_PUBLISHER`,
`ROLE_REVIEWER`, `ROLE_ADMIN`, and `VALID_ROLES`. Neither
`/api/auth/google` nor `/api/auth/signup` ever pass a role — new
accounts always land on `ROLE_BASIC`.

### Report deletion: instant vs. review-gated

Two different paths, depending on who's deleting what:

- **Admin, any report, any review_status** — `DELETE /api/reports/<id>`
  soft-deletes instantly, same as before this tier existed.
- **Publisher/reviewer, their own report, NOT yet published**
  (`pending_review`/`changes_requested`/`rejected`) — same instant
  `DELETE /api/reports/<id>`, since the report was never public and
  there's nothing for anyone else to weigh in on.
- **Publisher/reviewer, their own PUBLISHED report** —
  `DELETE /api/reports/<id>` returns 409. Instead:
  1. `POST /api/reports/<id>/request-deletion` with a required
     `reason` - the report stays visible on the public Reports page
     throughout (deliberately - see `REVIEW_STATUS_DELETION_REQUESTED`'s
     own comment in `models/report.py`), `review_status` becomes
     `deletion_requested`.
  2. A `reviewer` or `admin` (not the uploader) decides via
     `POST /api/reports/<id>/deletion-review` with
     `{"decision": "approve"}` or `{"decision": "deny"}` - unlike the
     3-approval/2-rejection publish workflow, **a single decision is
     final immediately** either way. Approve soft-deletes it (recording
     `deleted_via="deletion_review"`); deny puts it back to `published`.

Every report soft-deleted while it was published (either path above)
appears on the admin-only Deleted Reports page
(`GET /api/reports/deleted`), which supports bulk hard-delete
(`DELETE .../permanent`) or repost (`POST .../repost`, which just
restores visibility - no re-review).

## How a route becomes tier-gated

Two independent layers — use both:

**1. Backend (the real enforcement).** `server/decorators.py`:

```python
@app.post("/api/documents")
@roles_required("publisher", "admin")
def upload_document():
    ...

@app.delete("/api/documents/<int:document_id>/permanent")
@roles_required("admin")
def remove_document_permanently(document_id):
    ...
```

`roles_required` reads `session["user_id"]`, loads that `User` row live,
and checks `.role` against the allowed set. This means a role change
takes effect on the user's *next request* — no token to expire or
refresh. `login_required` is the same idea without the role check, for
routes that just need "someone is signed in".

**2. Frontend (the UX layer).** `client/src/components/ProtectedRoute.jsx`
redirects users away from pages they can't use; `NavBar.jsx` only shows
links for actions a user's role permits. Purely cosmetic — always pair
with the backend gate above; a determined user could hit the API
directly otherwise.

## How to promote someone

No self-service or API path exists for this on purpose. The person needs
an existing row (signed up/in at least once, via either method), then
from `server/`:

```bash
python promote_user.py someone@example.com publisher
python promote_user.py someone@example.com admin
python promote_user.py someone@example.com basic   # demote
```

## Soft delete vs. hard delete vs. role

Two separate deletion concepts exist for documents, and neither is about
permissions:

- **Soft delete** (`DELETE /api/documents/<id>`, publisher/admin):
  flips `status` to 0. The row, file, and event history all survive —
  this is what "delete" means for everyday use.
- **Hard delete** (`DELETE /api/documents/<id>/permanent`, admin only):
  actually removes the row (cascading to its events) and the underlying
  file/object via the storage backend. Irreversible — this exists for
  admin cleanup, not routine use, and is logged at `WARNING` level.

`User.status` works the same way for accounts — `delete_user()` only
ever soft-deletes; there's no hard-delete-a-user route today.

## Extending this further

- **A fourth tier:** add it to `VALID_ROLES` in `models/user.py`, then
  reference it in whatever `roles_required(...)` calls should include it.
- **An admin dashboard for promotions** instead of the CLI script: add
  `GET /api/users` + `PATCH /api/users/<id>/role`, gated with
  `@roles_required("admin")`, plus a small React admin page.
- **Per-resource ownership:** a separate check from role — e.g.
  `remove_document` already checks `doc.user_id == user.id` *in addition
  to* the role check, so publishers can only soft-delete their own
  documents, not each other's. `remove_document_permanently` currently
  skips the ownership check since it's admin-only by design; add one if
  you want admins restricted to their own uploads too.