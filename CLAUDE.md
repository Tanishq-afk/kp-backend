# CLAUDE.md

Guidance for Claude Code working in this repo. Keep this file short — the full
spec lives in [CONTEXT.md](CONTEXT.md); read it for data models, billing rules,
barcode flow, and the route surface. Don't re-explore what's documented there.

## What this is
`kp-backend` — Express + MongoDB (Mongoose) backend for a shop's inventory +
sales/POS system. Two roles: **admin** (inventory + billing) and **superadmin**
(oversight: dashboards, reports, manage admins). React + MUI frontend is later.

## Commands
- `npm run dev` — start with nodemon
- `npm start` — start once
- `npm run seed` — create the two fixed accounts (superadmin + admin) from `.env`, idempotent
- No test runner yet. Verify changes by booting the server and hitting endpoints
  with `curl`/`fetch` against the live DB (see "Verifying" below).

## Critical environment facts
- **PORT is 5050**, not 5000 — macOS AirPlay Receiver holds 5000. App reads
  `PORT` from `.env`.
- Mongo database name is **`kidzplaza`** (Atlas). `.env` is git-ignored; never
  commit it or print its secrets.
- Node 23, **ES modules** (`"type": "module"`) — use `import`/`export`, not
  `require`. Include `.js` in relative import paths.

## Architecture & conventions
Request flow: **route → (validate) → (protect/restrictTo) → controller → service → model**.
- **Controllers** are thin: parse req, call a service, send the response. Wrap
  every async handler in `asyncHandler` (utils) so errors reach the error handler.
- **Services** hold business logic and throw `ApiError(status, msg, errors?)`.
- **Models** in `src/models`; shared enums/constants in
  [src/config/constants.js](src/config/constants.js) — the single source of truth
  (roles, size sets, payment methods, statuses, counter keys). Add new enums there.
- **Auth:** `protect` (JWT) then `restrictTo(ROLE.X)` from
  [src/middleware/auth.middleware.js](src/middleware/auth.middleware.js).
  Inventory/billing = admin; dashboards/reports/admin-management = superadmin.
- **Validation:** express-validator checks in the route, then the `validate`
  middleware ([src/middleware/validate.js](src/middleware/validate.js)).
- **Sequences:** never hand-roll counters; use `getNextSequence` /
  `reserveSequenceBlock` (utils/sequence.js) backed by the `Counter` model.
- **Money/stock are touched only at bill completion** — held bills get no invoice
  number and no stock change. Snapshot product fields onto Barcode/Bill items so
  history stays correct after edits.

## Response shape (keep consistent)
- Success: `{ "success": true, "data": ... }`
- Error: `{ "success": false, "message": "...", "errors"?: [...] }` — produced by
  the central error handler; just `throw new ApiError(...)`.

## Adding a module (pattern to copy from `auth`)
1. Model in `src/models` (+ enums in `config/constants.js`).
2. `src/services/<name>.service.js` — logic, throws `ApiError`.
3. `src/controllers/<name>.controller.js` — thin, `asyncHandler`-wrapped.
4. `src/routes/<name>.routes.js` — validators + `protect`/`restrictTo`.
5. Mount in [src/app.js](src/app.js) under `/api/<name>`.
6. Update CONTEXT.md (route surface + build phases).

## Verifying changes
Boot the server, run a temporary `*.mjs` script using global `fetch` against
`http://localhost:5050`, assert status codes / payloads, then **delete any test
data and the temp script** (see the auth verification done previously). Don't
leave test artifacts or test accounts in the DB.

## Status
Done: scaffold + all schemas, **auth** (login/JWT, protect/restrictTo, me,
superadmin-creates-admin), **categories + products** (admin-only writes; product
create generates barcodes in a transaction), **barcode/print** (print-queue,
mark-printed, scan/lookup), **customers** (CRUD, phone-unique, lookup +
upsertByPhone), **billing** (scan → %/₹ discount → split payment → hold/resume →
complete; atomic sold+stock; history), **dashboard/reports** (superadmin:
summary, day-wise sales (IST), payment/category pies, top products) — all
verified e2e. Backend feature-complete per CONTEXT.md §12. Possible follow-ups:
admin management (list/activate admins), then the React + MUI frontend.
