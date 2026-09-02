# Booking System

A room/slot booking application where **double-booking is structurally impossible**, even
when two users race to book the same resource and time simultaneously.

```
booking-system/
  backend/     Express + TypeScript API, SQLite (node:sqlite) database, all business rules
  frontend/    React + Vite UI
  e2e/         Playwright end-to-end browser tests
  screenshots/ Captured "Slot taken" conflict screenshot
```

## Quick start

```bash
npm install                 # installs all three workspaces

# Backend
npm run seed --workspace backend   # creates backend/data.sqlite, seeds rooms only
npm run dev:backend                # http://localhost:4000

# Frontend (separate terminal)
npm run dev:frontend               # http://localhost:5173 (proxies /api to :4000)

# Backend unit + integration + concurrency tests
npm run test:backend

# Real-browser e2e test (spins up its own backend+frontend on separate ports)
npm run e2e
```

Open the app and you'll land on a login screen: pick **New user** to sign up with a name, email,
and password (with confirmation), or **Existing user** to log in with an email/password you
already created — there's also a "Forgot password?" link. Regular accounts aren't pre-seeded —
everyone creates their own, and each user only ever sees and manages their own bookings. The
one exception is a seeded **default admin account** (`admin@gmail.com` / `password123`) —
log in with it and you'll immediately be forced to set a new password before doing anything
else. See "Roles and the default admin account" below.

---

## Architecture

```
React UI  →  Express routes  →  Booking service (business rules)  →  SQLite
```

- **`frontend/`** — React 18 + Vite + react-router. `src/api/client.ts` is the only place that
  talks to the API. Availability display and the "Slot taken" UX live here, but nothing about
  conflict *detection* does — the UI never decides whether a booking is allowed.
- **`backend/src/routes/*.ts`** — thin HTTP layer: parse the request, call the service, map the
  result/error to a status code. No business logic here. `admin.ts` mounts every admin endpoint
  behind `requireAuth` + `requireAdmin`; `auth.ts` covers signup/login/logout/me/change-password/
  forgot-password/reset-password.
- **`backend/src/middleware/auth.ts`** — resolves a bearer token to a real, currently-active
  user on every request (`requireAuth`), and separately enforces the `ADMIN` role
  (`requireAdmin`) — backend-enforced authorization, never a frontend-only check.
- **`backend/src/services/`** — owns every business rule, one file per concern:
  `bookingService.ts` (overlap/concurrency/cancellation/booking references),
  `authService.ts` (signup/login/sessions/password reset/the default admin),
  `resourceService.ts` (resource CRUD/validation/status), `userAdminService.ts` (activate/
  deactivate), `dashboardService.ts` (admin summary stats), `auditLog.ts`. These are the single
  source of truth and are exercised directly by the unit tests, not just through HTTP.
- **`backend/src/db/`** — schema + connection setup, using Node's built-in `node:sqlite`
  module (no native build toolchain required — see "Why SQLite" below). New columns for an
  already-running database are added via small guarded `ALTER TABLE` migrations in
  `db/index.ts`, so upgrading in place doesn't require wiping existing data.

## Booking conflict algorithm

Bookings are half-open intervals `[startAt, endAt)`. Two bookings for the same resource
conflict if and only if:

```sql
existing.startAt < requested.endAt
AND
existing.endAt   > requested.startAt
```

Because the comparison is strict on both sides, a booking that **ends exactly when another
starts does not conflict** — `10:00–11:00` and `11:00–12:00` are both allowed for the same
room. `4:30 PM–5:30 PM` is a completely ordinary interval; there's no hourly-slot grid
anywhere in the system, so any start/end pair works as long as `start < end`.

## Concurrency strategy

**This is the core requirement of the whole project: never trust the UI, and never let a
check-then-write gap exist at the database layer either.**

`createBooking()` (`backend/src/services/bookingService.ts`) runs the overlap check and the
`INSERT` inside a single SQLite transaction opened with `BEGIN IMMEDIATE` instead of a plain
`BEGIN`:

```js
db.exec("BEGIN IMMEDIATE");
try {
  const conflict = db.prepare(/* overlap query */).get(...);
  if (conflict) throw SLOT_TAKEN;
  db.prepare(/* insert */).run(...);
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
```

`BEGIN IMMEDIATE` acquires SQLite's single write lock **before** the transaction does any
reads, rather than lazily on first write like a plain `BEGIN` would. If two requests race for
the same resource/time:

1. Both reach `createBooking()` at roughly the same moment (Express's async body-parsing
   middleware genuinely lets two in-flight HTTP requests interleave up to this point).
2. Whichever one calls `BEGIN IMMEDIATE` first gets the write lock. The second one blocks
   (SQLite queues writers; `PRAGMA busy_timeout = 5000` gives it up to 5s rather than failing
   immediately).
3. The first transaction sees no conflict, inserts, and commits — releasing the lock.
4. The second transaction now proceeds, re-runs the *exact same* overlap query against the
   now-committed state, sees the row the first request just inserted, and throws `SLOT_TAKEN`
   — which rolls back its transaction and returns `409 Conflict`.

**Exactly one request ever reaches `INSERT`. The other is rejected with `409` before it ever
gets the chance.** This is proven by `backend/tests/integration/concurrency.test.ts`, which
fires 2 (and separately 10) simultaneous HTTP requests for the identical resource/time via
`Promise.all` against a real running Express server, and asserts exactly one `201` and the
rest `409`, then queries the database directly to confirm exactly one `CONFIRMED` row exists.

**What happens if two people book the same slot at exactly the same time?** Exactly one wins,
deterministically decided by which transaction acquires SQLite's write lock first — never by
which HTTP response happens to arrive at the client first, and never by a race between reading
and writing. The loser gets a clear, honest `409 SLOT_TAKEN`, not a silent overwrite and not a
generic 500.

### Why SQLite (and not the Postgres `EXCLUDE` constraint the brief suggests)

The brief's ideal is a PostgreSQL `EXCLUDE` constraint over a `tstzrange` — the database
engine itself refuses the second `INSERT`, no application code required. That's the strongest
possible guarantee and is genuinely the better choice for a multi-instance production
deployment. This project uses SQLite via Node's built-in `node:sqlite` module instead, because
no PostgreSQL/Docker was available in the target environment and `better-sqlite3` requires a
native build toolchain (Visual Studio C++ workload) that also wasn't installed there.

SQLite has no range/exclusion constraint, so the guarantee above is implemented as "the
strongest correct transactional/locking strategy supported by the database" instead, per the
brief's fallback instruction. `BEGIN IMMEDIATE` is SQLite's standard mechanism for this exact
problem — it's the same technique SQLite's own documentation recommends for "first writer
wins" concurrency control. To port this to Postgres, `bookingService.ts` would change to a
single `INSERT ... WHERE NOT EXISTS (...)` guarded by an `EXCLUDE USING gist` constraint, and
the try/catch around a unique-violation error code would replace the `BEGIN IMMEDIATE` wrapper
— the interface (`createBooking`, `cancelBooking`, one `DatabaseSync`-shaped connection param)
was kept intentionally thin so that swap only touches `db/index.ts` and
`bookingService.ts`, not the routes or the frontend.

One caveat specific to this implementation: because the whole app runs as one Node process
against one `node:sqlite` connection, and `node:sqlite` calls are synchronous, Node's
single-threaded event loop already serializes the critical section on its own even without
`BEGIN IMMEDIATE`. The explicit transaction is still what's documented and tested here because
it's the part of the design that would keep holding correctly if the process model changed
(worker threads, a Node cluster, multiple connections to the same file) — it does not rely on
"only one JS callback runs at a time" as its safety argument.

## Cancellation rules

A `CONFIRMED` booking can be cancelled until **1 minute before its `startAt`**. Cancelling sets
`status = CANCELLED` and stamps `cancelledAt`; rows are never deleted, so cancellation history
is preserved.

```
now                    startAt
 |---------2min---------|   -> allowed
 |---------1min---------|   -> allowed (exactly the cutoff)
 |---59s----|               -> rejected (409 CANCELLATION_WINDOW_CLOSED)
                    now -> after startAt -> rejected
```

The rule is `startAt - now >= 60_000ms`. This is enforced in `cancelBooking()` — same service,
same file as booking creation — and re-checked on every cancel request regardless of what the
UI's cancel button currently shows (the UI hides the button once the window has closed, but
that's a courtesy, not the enforcement).

A cancelled booking's `[startAt, endAt)` is immediately free again: the overlap query only
ever looks at `status = 'CONFIRMED'` rows, so a new booking for the same resource/time succeeds
right after cancellation (`bookingService.test.ts` → "a cancelled booking releases its slot").

## Timezone strategy

- Every timestamp is stored as a UTC ISO-8601 string (`toISOString()` — always ends in `Z`).
- Every comparison (`overlap`, `past`, `cancellation cutoff`) happens on `Date.getTime()`
  (UTC epoch milliseconds), never on wall-clock strings, so server-local time is never the
  business truth.
- The API accepts any ISO-8601 timestamp, with or without an offset; `new Date(value)`
  normalizes it to the correct UTC instant regardless of which offset the client sent
  (`backend/tests/unit/time.test.ts` → "normalizes an offset timestamp to the same UTC instant
  as Z").
- The frontend's booking form uses native `<input type="date">` / `<input type="time">`, which
  the browser interprets in the device's local timezone — `new Date(...)` on that value already
  resolves to the correct UTC instant, so no manual offset math is needed for booking creation.
- Display is independent of that: a "Timezone" selector in the header (`frontend/src/context.tsx`)
  lets you view all your bookings' times formatted in any IANA timezone via
  `Intl.DateTimeFormat(..., { timeZone })`, so you can confirm the same UTC instant renders
  correctly across timezones without changing your OS clock.

## Availability vs. booking (advisory vs. authoritative)

`GET /api/resources/:id/availability` runs the same overlap query as booking creation and
returns `{ available, advisory: true }`. The UI uses it to show a live "Available" /
"Unavailable" badge as you pick a time — but it is explicitly advisory. Nothing stops the
underlying slot from being taken by someone else between that GET and your subsequent POST.
`POST /api/bookings` re-runs the identical check, atomically, inside the `BEGIN IMMEDIATE`
transaction described above, and that is the only check that actually decides the outcome.

## Unavailable slot UX

When `POST /api/bookings` returns `409 SLOT_TAKEN`, the frontend shows:

> **Slot taken**
> This resource is no longer available for the selected time. Please choose another time.

The response body is `{ "error": "SLOT_TAKEN", "message": "..." }` — it contains no reference
to who holds the conflicting booking, their name, or their email
(`backend/tests/integration/bookings.api.test.ts` → "returns 409 SLOT_TAKEN without leaking
the other user's info" asserts this directly). The booking page also offers a one-click
"Try one hour later" action that shifts the requested window and re-checks availability.

## API

| Method | Path                                | Notes                                              |
|--------|--------------------------------------|-----------------------------------------------------|
| GET    | `/api/resources`                    | List resources — `?q&status&minCapacity&facilities` |
| GET    | `/api/resources/:id`                | Resource detail                                     |
| GET    | `/api/resources/:id/availability`   | `?startAt&endAt` — advisory only                    |
| GET    | `/api/bookings`                     | Current user's bookings                             |
| POST   | `/api/bookings`                     | `{ resourceId, startAt, endAt }` → 201/400/404/409  |
| GET    | `/api/bookings/:id`                 | Single booking (must belong to caller)              |
| POST   | `/api/bookings/:id/cancel`          | → 200, or 409 if the cancellation window has closed |
| POST   | `/api/auth/signup`                  | `{ name, email, password, confirmPassword }`        |
| POST   | `/api/auth/login`                   | `{ email, password }`                               |
| POST   | `/api/auth/logout`                  | Invalidates the current token                       |
| GET    | `/api/auth/me`                      | Current user                                        |
| POST   | `/api/auth/change-password`         | `{ currentPassword, newPassword, confirmPassword }` |
| POST   | `/api/auth/forgot-password`         | `{ email }` — always the same generic response      |
| POST   | `/api/auth/reset-password`          | `{ token, newPassword, confirmPassword }`           |
| GET    | `/api/admin/dashboard`              | Summary counts — **ADMIN only**                     |
| GET    | `/api/admin/users`                  | All users, no password hashes — **ADMIN only**      |
| POST   | `/api/admin/users/:id/status`       | `{ status: ACTIVE\|INACTIVE }` — **ADMIN only**     |
| GET    | `/api/admin/bookings`               | All bookings, joined — `?q&date&resourceId&status&userId` — **ADMIN only** |
| GET    | `/api/admin/bookings/export.csv`    | Same filters, CSV download — **ADMIN only**         |
| POST   | `/api/admin/bookings/:id/cancel`    | Cancels any booking, bypasses the cutoff — **ADMIN only** |
| POST/PATCH/DELETE | `/api/admin/resources[/:id]` | Create/update/delete — **ADMIN only**              |
| POST   | `/api/admin/resources/:id/status`   | `{ status: AVAILABLE\|MAINTENANCE\|DISABLED }` — **ADMIN only** |
| GET    | `/api/admin/audit-logs`             | Recent admin-visible actions — **ADMIN only**       |

Errors are always `{ "error": "CODE", "message": "human-readable text" }`. Unexpected
exceptions are logged server-side and returned as a generic `500 INTERNAL_ERROR` — internal
details (stack traces, SQL) are never sent to the client.

### Authentication

Real signup/login, no third-party auth provider:

- `POST /api/auth/signup` — `{ name, email, password, confirmPassword }`. Password must be at
  least 8 characters and match `confirmPassword`; email must be unique (`409 EMAIL_TAKEN`
  otherwise) — normalized to lowercase before every lookup/insert, so `John@x.com` and
  `john@x.com` collide as the same account. The password is hashed with Node's built-in
  `crypto.scrypt` (`backend/src/utils/password.ts`) — salted, one-way, never stored or logged
  in plaintext, and never returned to any client (`authService.ts` strips it before building
  any response — see `backend/tests/integration/auth.api.test.ts`).
- `POST /api/auth/login` — `{ email, password }`. A wrong password and an unknown email both
  return the identical `401 INVALID_CREDENTIALS`, so the API never reveals whether an account
  exists for a given email (no user enumeration). A deactivated account (see "Account status"
  below) gets `403 ACCOUNT_INACTIVE` instead.
- Both return `{ user, token }`. The frontend stores `token` in `localStorage` and sends it as
  `Authorization: Bearer <token>` on every subsequent request; `backend/src/middleware/auth.ts`
  resolves that token to a real user id **and re-checks that user's current role/status** via
  the `sessions` table before any route handler runs — not just at login time, so deactivating
  a user mid-session immediately invalidates their existing token too.
  **The server never trusts a client-supplied user id** — `userId` only ever comes from that
  verified session lookup, so you cannot act as another user by guessing or sending their id.
- Sessions expire after 7 days (`sessions.expiresAt`); `POST /api/auth/logout` deletes the
  session row immediately, invalidating that token right away.
- `POST /api/auth/change-password` requires the correct current password and clears the
  `passwordChangeRequired` flag (see "Default admin account" below).
- `POST /api/auth/forgot-password` / `POST /api/auth/reset-password` implement a real
  token-based reset: a one-time, 30-minute token is generated and — since no email provider is
  configured — logged to the **server console** as a clickable link instead of actually being
  emailed (`[password reset] user@x.com -> http://localhost:5173/reset-password?token=...`).
  See "Remaining configuration" below for what a production deploy needs to wire up here.
- You cannot cancel someone else's booking by guessing their booking id — you get the same
  `404` as for a booking that doesn't exist, so existence isn't leaked either.

### Roles and the default admin account

Two roles: `USER` (default, via signup) and `ADMIN`. **Every `/api/admin/*` route is guarded by
`requireAdmin` middleware that checks the role from the verified session** — never a frontend
check, never a hidden button. `backend/tests/integration/admin.api.test.ts` proves this
directly: it calls every admin endpoint with a regular user's valid token and asserts `403` on
all of them, plus `401` with no token at all.

On first boot, `ensureDefaultAdmin()` (`backend/src/services/authService.ts`) idempotently
creates:

```
Name:     Admin
Email:    admin@gmail.com
Password: password123    (passwordChangeRequired = true)
Role:     ADMIN
```

Logging in with that password returns `passwordChangeRequired: true` in the user object; the
frontend (`App.tsx`) renders **only** the forced "Set a new password" screen until
`POST /api/auth/change-password` succeeds — every other route is unreachable in that state. On
subsequent logins the flag is `false` and the admin goes straight to the dashboard, exactly as
specified.

### Account status

Users have `status: ACTIVE | INACTIVE`. An admin toggles this via
`POST /api/admin/users/:id/status` (frontend shows a confirmation dialog first). An `INACTIVE`
account cannot log in (`403 ACCOUNT_INACTIVE`) and, if already logged in, loses access on their
very next request (session lookup re-checks status live, not just at login). An admin cannot
deactivate their own account (`userAdminService.ts` blocks it, to avoid a self-lockout).
Deactivating a user never touches their booking history — bookings are keyed by `userId`, not
gated by the user's current status.

## Resource management

Resources now carry: place name (`name`), landmark (`location`), "best for use", description,
optional capacity, optional facilities (stored as JSON, e.g. `["Wi-Fi", "TV"]`), optional
image URL, and a `status`: `AVAILABLE | MAINTENANCE | DISABLED`.

- **Required-field validation is enforced on both ends.** The admin "Add resource" button is
  disabled until place name, landmark, best-for-use, and description are all non-whitespace
  (`AdminResources.tsx`); `resourceService.createResource`/`updateResource` re-validate the
  same rule server-side and reject whitespace-only values with `400` — you cannot bypass the
  frontend by calling the API directly (`admin.api.test.ts` proves this).
- **`MAINTENANCE` and `DISABLED` both block new bookings** — `bookingService.createBooking`
  checks `resource.status === 'AVAILABLE'` before the overlap check even runs, returning
  `409 RESOURCE_UNAVAILABLE` with a status-specific message. Existing historical bookings for
  that resource are untouched.
- **Deleting a resource is refused if any booking (any status) references it** — `409
  RESOURCE_HAS_BOOKINGS`, with the message pointing you to Disable instead. This is what keeps
  the admin "who booked what" view from ever showing a dangling resource reference.
- Users can search/filter resources by free text (`?q=`), status, minimum capacity, and
  facilities; the resource card shows a 🟢/🟡/⚫ status tag, facility chips, and pins the "Book
  this room" button to the card's bottom-left corner, per spec.

Image support is a plain `imageUrl` text field (no upload widget/file storage — this project
has no object storage configured; see "Remaining configuration").

## Booking reference IDs & admin booking management

Every booking gets a human-readable, sequential reference like `BK-2026-000001`
(`nextBookingRef()` in `bookingService.ts`, backed by a `booking_counters(year, seq)` table).
The increment happens **inside the same `BEGIN IMMEDIATE` transaction** as the overlap check
and insert, so it's exactly as race-free as the no-double-booking guarantee itself — two
concurrent bookings can never receive the same reference, and a rolled-back conflicting booking
never burns a number for a booking that doesn't exist. It's shown in the booking confirmation,
My Bookings, and every admin bookings view.

Admins see every booking (`GET /api/admin/bookings`, joined with the user and resource
they belong to — name, email, resource, date, times, status, created time), can search/filter
by user, email, booking ID, resource, date, and status, can cancel **any** booking (a
confirmation dialog in the UI, then `adminCancelBooking()` — which deliberately bypasses the
1-minute-before-start cutoff a regular user is held to, since an admin override is exactly for
the case where a normal user no longer can), and can export the current filtered view as CSV.

## Audit log

`backend/src/services/auditLog.ts` records: user registration, login success/failure/blocked
(inactive account), password changes and resets, booking creation and cancellation (by the
owner or an admin override), and every admin resource/user mutation. Never a password, hash, or
reset token. Visible only via `GET /api/admin/audit-logs` (ADMIN-only, same middleware as every
other admin route) — `admin.api.test.ts` confirms a regular user gets `403` there too, and that
the returned entries never contain anything matching `passwordHash`.

## Testing

`npm run test:backend` runs all of the following (88 tests):

- **`tests/integration/admin.api.test.ts`** — the most important new suite: every admin
  endpoint rejects a regular USER with `403` and an unauthenticated request with `401`;
  activate/deactivate (including the self-lockout guard and that a deactivated user's *existing*
  session stops working immediately); resource create/edit/status/delete including the
  required-field and whitespace-only validation and the "can't delete a resource with bookings"
  rule; setting a resource to `MAINTENANCE` actually blocks a booking attempt through the real
  booking endpoint; the admin bookings view shows user+resource details and a valid
  `BK-YYYY-NNNNNN` reference; admin cancellation bypasses the normal cutoff; CSV export; and
  that the audit log captures booking creation/cancellation and is itself admin-only.

- **`tests/integration/auth.api.test.ts`** — signup (success, duplicate email including
  case-insensitively, weak password, mismatched confirmPassword, missing/invalid fields), login
  (success, case-insensitive email, wrong password, unknown email — both give the same `401`,
  a deactivated account gets `403`), `GET /me`, logout actually invalidates the token,
  change-password (clears `passwordChangeRequired`, old password stops working, wrong current
  password rejected), and the full forgot/reset-password flow (issued token works once, a
  reused or expired token is rejected, an unknown email gets the same generic response as a
  known one).

- **`tests/unit/time.test.ts`** — the pure overlap function against the spec's exact boundary
  matrix (adjacent bookings don't overlap; the 4:00–5:00 / 4:30–5:30 / 4:00–4:30 / 5:30–6:30
  examples from the brief), plus timestamp parsing/timezone-normalization.
- **`tests/unit/bookingService.test.ts`** — the service layer directly (not through HTTP), so
  cancellation-window boundaries can be tested with an injected `now` for determinism:
  validation (unknown resource, past start, end-before-start, zero-duration, bad timestamps,
  unknown user), the full overlap matrix (exact/partial/contains/adjacent), the spec's boundary
  example, cancellation at 2min/1min/59s/after-start, double-cancel, and "a cancelled booking
  releases its slot."
- **`tests/integration/bookings.api.test.ts`** — the HTTP layer end-to-end via `supertest`:
  status codes (201/400/401/404/409), the availability endpoint, and specifically that a 409
  response never contains another user's name or email.
- **`tests/integration/concurrency.test.ts`** — **the mandatory test.** Fires 2, then
  separately 10, simultaneous `POST /api/bookings` requests for the identical resource/time via
  `Promise.all` against a real listening Express server, asserts exactly one `201` and the rest
  `409`, and queries SQLite directly afterward to confirm exactly one `CONFIRMED` row exists.
  This is what actually proves the concurrency strategy above, not just that the code compiles.

`npm run e2e` runs a real-browser Playwright test
(`e2e/tests/slot-taken.spec.ts`) against the actual running app (own backend/frontend
instances on dedicated ports, fresh seeded database): one browser context books a room through
the real UI form, a second independent browser context attempts the identical resource/time
and is shown the "Slot taken" panel (not a generic error), asserts no `@example.com` address
leaks into the page, and saves a screenshot to `screenshots/slot-taken.png`.

## Remaining configuration

Everything above runs out of the box with zero external accounts. A few things are
intentionally stubbed rather than wired to a real third-party service, since none was
available/requested for this project — each is a small, isolated change if you need it later:

- **Email delivery.** `POST /api/auth/forgot-password` logs the reset link to the server
  console instead of emailing it (`authService.requestPasswordReset`). To go live, swap that
  `console.log` for a call to whatever transactional email provider you use (SES, Postmark,
  SendGrid, etc.) — the token generation/expiry/one-time-use logic around it doesn't change.
  Set `FRONTEND_URL` in the backend's environment so the logged link points at the right host.
- **Resource images.** `imageUrl` is a plain text field (paste an external URL) — there's no
  file upload widget or object storage (S3/Cloudinary/etc.) wired up.
- **Booking reminders.** "Starts in N minutes" is shown client-side in My Bookings for
  anything within the next 30 minutes while that page is open — there's no push notification,
  email, or background job, since that needs a real notification channel to be worth building.
- **CSV only for export**, not Excel/PDF — per the brief's own preference, and to avoid pulling
  in a spreadsheet/PDF-generation dependency for a feature that CSV already fully covers.
- **No analytics charts** — the dashboard is numeric stat cards only, to avoid a new charting
  dependency; the underlying data (`GET /api/admin/dashboard`) is there if you want to add one.
- **Default admin credentials** (`admin@gmail.com` / `password123`) are meant to be rotated
  immediately via the forced first-login change — don't leave them as-is past initial setup on
  a real deployment.

## Definition of done — status

All items in the original booking-correctness brief are implemented and covered by the tests
above: resource listing, arbitrary-duration bookings, past/invalid-range rejection,
adjacent-allowed / overlap-rejected, cancel-releases-slot, the 1-minute cancellation cutoff
(both directions), UTC storage with local-timezone display, advisory-vs-authoritative
availability, the database-level concurrency guarantee, and the real-browser conflict
screenshot.

The subsequent role/admin/resource-management upgrade (registration with confirm-password,
case-insensitive duplicate-email protection, password visibility toggles, forgot/reset
password, USER/ADMIN roles enforced server-side, the default admin + forced first-login
password change, account activate/deactivate, resource CRUD with required-field validation and
AVAILABLE/MAINTENANCE/DISABLED status, sequential booking reference IDs, admin dashboard/users/
bookings/resources/audit-log views, admin booking cancellation with a confirmation dialog, CSV
export, and the audit log itself) is implemented and covered the same way — see the sections
above and `backend/tests/integration/admin.api.test.ts` in particular. All prior functionality
(booking creation, the concurrency guarantee, cancellation, the "Slot taken" UX, timezone
handling) was re-verified passing after this upgrade, not assumed to still work.
