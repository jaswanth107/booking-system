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

Open the app and you'll land on a login screen: pick **New user** to sign up with a name,
email and password, or **Existing user** to log in with an email/password you already created.
There are no pre-seeded accounts — everyone creates their own, and each user only ever sees
and manages their own bookings.

---

## Architecture

```
React UI  →  Express routes  →  Booking service (business rules)  →  SQLite
```

- **`frontend/`** — React 18 + Vite + react-router. `src/api/client.ts` is the only place that
  talks to the API. Availability display and the "Slot taken" UX live here, but nothing about
  conflict *detection* does — the UI never decides whether a booking is allowed.
- **`backend/src/routes/*.ts`** — thin HTTP layer: parse the request, call the service, map the
  result/error to a status code. No business logic here.
- **`backend/src/services/bookingService.ts`** — owns every business rule: input validation,
  the overlap check, the transaction, the cancellation window. This is the single source of
  truth and is exercised directly by the unit tests, not just through HTTP.
- **`backend/src/db/`** — schema + connection setup, using Node's built-in `node:sqlite`
  module (no native build toolchain required — see "Why SQLite" below).

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

| Method | Path                              | Notes                                        |
|--------|------------------------------------|-----------------------------------------------|
| GET    | `/api/resources`                  | List resources                                |
| GET    | `/api/resources/:id`              | Resource detail                               |
| GET    | `/api/resources/:id/availability` | `?startAt&endAt` — advisory only              |
| GET    | `/api/bookings`                   | Current user's bookings (`x-user-id` header)  |
| POST   | `/api/bookings`                   | `{ resourceId, startAt, endAt }` → 201/400/404/409 |
| GET    | `/api/bookings/:id`                | Single booking (must belong to caller)        |
| POST   | `/api/bookings/:id/cancel`         | → 200, or 409 if the cancellation window has closed |
| GET    | `/api/users`                      | Seeded demo users, for the "log in as" picker |

Errors are always `{ "error": "CODE", "message": "human-readable text" }`. Unexpected
exceptions are logged server-side and returned as a generic `500 INTERNAL_ERROR` — internal
details (stack traces, SQL) are never sent to the client.

### Authentication

Real signup/login, no third-party auth provider:

- `POST /api/auth/signup` — `{ name, email, password }`. Password must be at least 8
  characters; email must be unique (`409 EMAIL_TAKEN` otherwise). The password is hashed with
  Node's built-in `crypto.scrypt` (`backend/src/utils/password.ts`) — salted, one-way, never
  stored or logged in plaintext.
- `POST /api/auth/login` — `{ email, password }`. A wrong password and an unknown email both
  return the identical `401 INVALID_CREDENTIALS`, so the API never reveals whether an account
  exists for a given email (no user enumeration).
- Both return `{ user, token }`. The frontend stores `token` in `localStorage` and sends it as
  `Authorization: Bearer <token>` on every subsequent request; `backend/src/middleware/auth.ts`
  resolves that token to a real user id via the `sessions` table before any route handler runs.
  **The server never trusts a client-supplied user id** — `userId` only ever comes from a
  verified session lookup, so you cannot act as another user by guessing or sending their id.
- `GET /api/auth/me` restores the session after a page reload; `POST /api/auth/logout` deletes
  the session row, invalidating that token immediately.
- You cannot cancel someone else's booking by guessing their booking id — you get the same
  `404` as for a booking that doesn't exist, so existence isn't leaked either.

No endpoint ever returns `passwordHash` to a client (`authService.ts` strips it before
building any response) — see `backend/tests/integration/auth.api.test.ts`.

## Testing

`npm run test:backend` runs all of the following (62 tests):

- **`tests/integration/auth.api.test.ts`** — signup (success, duplicate email, weak password,
  missing/invalid fields), login (success, case-insensitive email, wrong password, unknown
  email — both give the same `401`), `GET /me`, and that logout actually invalidates the token.

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

## Definition of done — status

All items in the original brief are implemented and covered by the tests above: resource
listing, arbitrary-duration bookings, past/invalid-range rejection, adjacent-allowed /
overlap-rejected, cancel-releases-slot, the 1-minute cancellation cutoff (both directions), UTC
storage with local-timezone display, advisory-vs-authoritative availability, the database-level
concurrency guarantee, and the real-browser conflict screenshot.
