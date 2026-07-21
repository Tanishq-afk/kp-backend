# KP — Inventory cum Sales Management

> Single source of truth for building and integrating this project. Keep this
> file updated as the backend and frontend evolve.

## 1. Overview

A web app to run a clothing shop: manage inventory, generate barcodes, run the
billing counter, and give the owner an oversight dashboard.

- **Backend (this repo, `kp-backend`):** Node + Express + MongoDB (Mongoose).
- **Frontend (separate, later):** React + Material UI.
- **Auth:** JWT access tokens + bcrypt password hashing + role-based middleware.

## 2. Roles & Permissions

| Capability                                   | admin | superadmin |
| -------------------------------------------- | :---: | :--------: |
| Login                                        |   ✅   |     ✅      |
| Create/edit categories                       |   ✅   |     ❌      |
| Create/edit products (inventory)             |   ✅   |     ❌      |
| Generate & print barcodes                    |   ✅   |     ❌      |
| Manage stock                                 |   ✅   |     ❌      |
| Billing counter (create bills, collect pay)  |   ✅   |     ❌      |
| Manage customers                             |   ✅   |     ❌      |
| View dashboards, sales/transaction reports   |   ❌   |     ✅      |
| Create / manage admin accounts               |   ❌   |     ✅      |

> **admin** owns the day-to-day shop operations (inventory + billing).
> **superadmin** is pure oversight: dashboards, reports (incl. pie charts), and
> managing admin accounts. This split is enforced server-side by role middleware
> in later phases.

## 3. Tech Stack & Dependencies

- **Runtime:** Node v23, ES modules (`"type": "module"`).
- **Prod:** express, mongoose, dotenv, bcryptjs, jsonwebtoken, cors, helmet,
  express-rate-limit, express-validator, morgan, nanoid.
- **Dev:** nodemon.

## 4. Project Structure

```
kp-backend/
  src/
    config/
      db.js              # mongoose connection
      constants.js       # roles, size sets, payment methods, status enums
    models/
      User.js            # admin / superadmin accounts
      Category.js        # product categories (name + gender)
      Product.js         # product master + per-size opening stock
      Barcode.js         # ONE doc per physical unit
      Customer.js        # customers (linked from Bill)
      Bill.js            # sales / invoices (split payments)
      Counter.js         # atomic sequence store
    controllers/
      auth.controller.js # login / register / me (thin; delegate to services)
    routes/
      auth.routes.js     # /api/auth/*
    services/
      auth.service.js    # login + registerAdmin business logic
    middleware/
      errorHandler.js    # notFound + central error handler
      auth.middleware.js # protect (JWT) + restrictTo(...roles)
      validate.js        # express-validator result -> 400 ApiError
    utils/
      sequence.js        # getNextSequence / reserveSequenceBlock
      barcodeGenerator.js# buildBarcodeValue / buildBarcodeDocs / countUnits
      jwt.js             # signToken / verifyToken
      ApiError.js        # operational error w/ statusCode + field errors
      asyncHandler.js    # wrap async handlers -> forward errors
    app.js               # express app + middleware wiring + route mounts
    server.js            # db connect + listen
  seed/
    seed.js              # create the fixed superadmin + admin (idempotent)
    importProducts.js    # one-time bulk import of the shop catalog (xlsx->JSON)
    importCustomers.js   # one-time bulk import of customers (xlsx->JSON)
    importBills.js       # one-time bulk import of historical bills (xlsx->JSON)
  .env.example
  .gitignore
  CONTEXT.md             # this file
  package.json
```

## 5. Environment Variables

Copy `.env.example` → `.env` and fill in:

| Var                  | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `PORT`               | HTTP port (use 5050 on macOS; 5000 = AirPlay) |
| `NODE_ENV`           | `development` / `production`                  |
| `MONGODB_URI`        | MongoDB connection string                     |
| `JWT_SECRET`         | Secret for signing JWTs                       |
| `JWT_EXPIRES_IN`     | Token lifetime, e.g. `7d`                     |
| `SUPERADMIN_NAME/EMAIL/PASSWORD` | Seed: the super admin login       |
| `ADMIN_NAME/EMAIL/PASSWORD`      | Seed: the admin login             |
| `CORS_ORIGINS`       | Comma-separated allowed frontend origins      |

## 6. Data Models

All models use Mongoose timestamps (`createdAt`, `updatedAt`).

### User
`name`, `email` (unique, lowercase), `password` (bcrypt, hidden by default),
`role` (`admin` | `superadmin`), `phone`, `isActive`, `createdBy` (ref User),
`lastLogin`.
- `pre('save')` hashes password on change. `comparePassword(plain)` method.
- Query the password explicitly with `.select('+password')` for login.

### Category
`name`, `gender` (`Male`|`Female`|`Unisex`|`Kids`), `isActive`, `createdBy`.
- Unique on **(name, gender)**, case-insensitive.

### Product
`name`, `articleNumber` (indexed), `category` (ref), `costPrice` (cost),
`mrp` (selling price), `sizeType` (`alpha`|`numeric`|`freesize`),
`sizes: [{ size, quantity }]` (opening stock per size), `totalOpeningStock`
(auto = sum of sizes), `currentStock` (live, decremented on sale), `isActive`,
`createdBy`.
- `pre('validate')` checks each size is valid for the `sizeType` and computes
  `totalOpeningStock`; sets `currentStock = totalOpeningStock` on creation.

### Barcode  (one document per physical unit)
`code` (unique, scannable), `serialNumber` (label number),
`product` (ref), snapshots: `productName`, `articleNumber`, `category`, `mrp`,
`size`; `status` (`available`|`sold`|`returned`|`void`),
`printStatus` (`pending`|`printed`), `bill` (ref, set on sale), `soldAt`,
`createdBy`.
- See §7 for generation. A `sold` barcode cannot be billed again.

### Customer
`name`, `phone` (unique — billing identity), `remarks`, `isActive`, `createdBy`.
Linked from Bill.

### Bill  (sale / invoice)
`billNumber` (assigned on completion; null while held — partial-unique index),
`status` (`held`|`completed`|`cancelled`|`refunded`), `holdRef` + `heldAt` (for
parked bills), `customer` (ref, nullable) + `customerName`/`customerPhone`
(snapshots), `items: [{ barcode, product, productName, articleNumber, size, mrp }]`
(snapshots; mrp = line price), `subtotal`,
`discountType` (`flat`|`percent`) + `discountValue` (raw) + `discount` (resolved ₹),
`tax`, `total`, `payments: [{ method, amount, reference }]` (split payments),
`amountPaid`, `changeReturned`, `paymentStatus` (`paid`|`partial`|`unpaid`),
`remarks`, `createdBy` (admin).
- `billNumber` is required only when `status === 'completed'`.

### Counter
`{ _id: <name>, seq: <number> }`. Mutated only via `$inc` through
`utils/sequence.js`. Keys: `bill`, `barcode`.

## 7. Barcode Generation Flow

When an admin creates a product with per-size quantities, the backend generates
one Barcode document per unit:

```
sizes: [{ size: 'XL', quantity: 3 }, { size: 'L', quantity: 4 }]  =>  7 barcodes
```

Implementation (in the product-create service, later phase):
1. `countUnits(product.sizes)` → total units needed (7).
2. `reserveSequenceBlock(COUNTER.BARCODE, 7)` → atomically reserve serials.
3. `buildBarcodeDocs(product, { startSerial, createdBy })` → 7 plain doc objects,
   each with a unique `code` (`KP00000123-4821`) and `serialNumber`.
4. `Barcode.insertMany(docs)`.

**Printing queue** = Barcode docs with `printStatus: 'pending'`. The admin
selects a product's pending barcodes and prints; the frontend renders the
scannable image (JsBarcode) from `code`, and the label shows: product name,
size, category, **MRP**, the serial number, and the barcode. All of these come
from snapshot fields on the Barcode doc, so the label is correct even if the
product is later edited. After printing, units are marked
`printStatus: 'printed'`.

## 8. Size Sets (`config/constants.js`)

- `alpha`:   XS, S, M, L, XL, XXL, XXXL
- `numeric`: 0, 2, then even sizes 10–42 (0, 2, 10, 12, … 42). 4/6/8 not stocked.
- `freesize`: Free Size

A product has exactly one `sizeType`; each `sizes[].size` must belong to it
(validated in the Product model).

## 9. Billing & Payments

**Counter flow:**
1. Admin **scans barcodes** (`code`); each unit must be `available`. Each scan adds
   a line item (snapshotting productName, articleNumber, size, mrp).
2. Admin enters **customer name + number**. The service upserts a Customer by phone
   and links it (`customer`), and snapshots `customerName` / `customerPhone` onto the
   bill for history.
3. Admin enters a **discount** — either a flat ₹ amount or a percentage:
   - `discountType`: `flat` | `percent`
   - `discountValue`: the raw number entered (e.g. `10` = ₹10 or 10%)
   - `discount`: the resolved rupee amount (percent is computed on the frontend as
     `subtotal × value / 100`; the backend stores/validates the resolved ₹).
4. Admin optionally adds **remarks** (stored on the bill).
5. Admin takes payment (split allowed) and completes the bill.

**Amounts:** `subtotal = Σ item.mrp`; `total = subtotal − discount + tax`.

**Split payments:** `payments[]` can mix `cash` / `card` / `upi`;
`amountPaid = Σ payments.amount`. `paymentStatus` (`paid`/`partial`/`unpaid`)
derives from `amountPaid` vs `total`.

**On completion (atomic in the billing service):** each item's Barcode →
`status: 'sold'`, `bill` set, `soldAt` set; Product `currentStock` decremented.

**Hold / park a bill:** the admin can park an in-progress bill to serve another
customer first, then resume it.
- Holding saves the bill with `status: 'held'`, a `holdRef` (e.g. `HOLD-12`, from the
  `hold` counter), and `heldAt`. **No invoice number is assigned and no stock changes**
  — so the invoice sequence stays gap-free and the units remain `available`.
- `GET /api/bills/held` lists parked bills (`holdRef`, `customerName`, item count,
  `total`, `heldAt`) to pick from; resuming loads it for further edits.
- On completion the bill is assigned its `billNumber`, `holdRef`/`heldAt` are cleared,
  and the normal completion effects run (barcodes sold, stock decremented). Item
  availability is validated at completion, not at hold time.
- A held bill may instead be discarded (deleted) without any stock impact.

**Billing history:**
- `GET /api/bills` → table rows: `createdAt` (date), `billNumber`, `customerName`,
  `remarks`, `total`, `paymentStatus` (supports date/customer filters + pagination;
  excludes `held` bills).
- `GET /api/bills/:id` → the full bill: all items, the discount breakdown
  (`discountType` / `discountValue` / `discount`), tax, payments, and customer — so
  clicking a history row shows the complete original bill.

## 10. API Conventions (for later phases)

- Base path: `/api`. Health check: `GET /health`.
- **Auth header:** `Authorization: Bearer <jwt>`.
- **Success envelope:** `{ "success": true, "data": ... }`.
- **Error envelope:** `{ "success": false, "message": "...", "errors"?: [...] }`
  (produced by `middleware/errorHandler.js`).
- HTTP codes: 400 validation, 401 unauthenticated, 403 forbidden (role),
  404 not found, 409 duplicate.

### Planned route surface (not built yet)
```
POST   /api/auth/login
POST   /api/auth/register        (superadmin → create admin)
GET    /api/auth/me

GET    /api/categories          (auth)   POST /api/categories       (admin)
GET    /api/categories/:id       (auth)   PATCH/DELETE /api/categories/:id (admin)
GET    /api/products             (auth)   POST /api/products         (admin, triggers barcodes)
GET    /api/products/:id         (auth, +barcode summary)
PATCH  /api/products/:id         (admin, details only)
DELETE /api/products/:id         (admin, blocked if any unit sold)

GET    /api/barcodes/print-queue  (auth)  pending labels grouped by product
GET    /api/barcodes             (auth)  filtered list (product/status/printStatus/size)
POST   /api/barcodes/print       (admin) mark printed by { ids } and/or { product }
GET    /api/barcodes/:code       (auth)  scan / lookup by code (+ product, category)

GET    /api/customers/lookup?phone=  (auth)  exact phone -> customer or null
GET    /api/customers             (auth)  list (search name/phone) + pagination
GET    /api/customers/:id         (auth)
POST   /api/customers             (admin) create (phone unique -> 409 on dup)
PATCH  /api/customers/:id         (admin)
DELETE /api/customers/:id         (admin) blocked if any bill references them

POST   /api/bills                (admin) create + complete a sale (atomic)
POST   /api/bills/hold           (admin) park an in-progress bill
GET    /api/bills/held           (admin) list parked bills
POST   /api/bills/:id/complete   (admin) resume held bill -> finalize
DELETE /api/bills/:id            (admin) discard a held bill (held only)
GET    /api/bills                (auth)  history (status/payment/date/search) + pagination
GET    /api/bills/:id            (auth)  full bill (items, discount, payments, customer)

GET    /api/dashboard/summary                  (superadmin) KPIs + today + counts
GET    /api/dashboard/sales/daily              (superadmin) day-wise series (IST, gap-filled)
GET    /api/dashboard/sales/payment-methods    (superadmin) pie: cash/card/upi
GET    /api/dashboard/sales/top-products       (superadmin) best sellers
GET    /api/dashboard/sales/by-category        (superadmin) pie: sales by category
   (all accept optional ?from=YYYY-MM-DD&to=YYYY-MM-DD)
```

## 11. Getting Started

```bash
npm install
cp .env.example .env   # fill in MONGODB_URI, JWT_SECRET, superadmin + admin creds
npm run seed           # create the two fixed accounts (superadmin + admin)
npm run dev            # start with nodemon (PORT=5050)
# GET http://localhost:5050/health  -> { success: true, status: "ok" }
```

Login is a single endpoint (`POST /api/auth/login`); the response includes the
user's `role`, so the frontend routes superadmin vs admin accordingly. Accounts
are seed-only (no public signup).

**Catalog import (one-time):** the shop's existing `product list.xlsx` was imported
via `seed/importProducts.js` — ~4,226 items → free-size products (ItemID→articleNumber,
UnitCost→costPrice, MRP→mrp, gender inferred from category), each with one barcode.
Idempotent (dedup by articleNumber). It reads a JSON produced from the xlsx by a small
Python stdlib converter; re-run only if reloading the catalog.
Customers were imported the same way via `seed/importCustomers.js` (~994 customers;
AccountName→name, BillingCellNo→phone; dedup by phone).
Historical bills were imported via `seed/importBills.js` (~83 bills; header-level
Daily Sale Report, no line items → `items: []`). It maps Total→subtotal,
Discount→discount, BillAmount→total, Cash/Card/Wallet→split payments (wallet=upi),
and preserves OrderDate as `createdAt` (so day-wise reports are correct). Customer
ref is linked by bracketed phone (creating if missing) else exact name match;
inserted via the native driver to bypass the items-required validator. Dedup by
billNumber.

## 12. Build Phases

1. ✅ **Scaffold & schemas** (this phase): models, config, utils, app/server,
   seed, CONTEXT.md, deps, .gitignore.
2. ✅ **Auth module:** login → JWT, `protect` + `restrictTo(role)` middleware,
   `GET /me`, superadmin-creates-admin (`POST /register`).
3. ✅ **Category & Product modules:** CRUD (admin-only writes; reads open to both
   roles). Product create generates barcodes atomically (transaction); product
   detail includes a live barcode summary. Reads support pagination + filters.
4. ✅ **Barcode/print module:** print-queue (grouped by product, per-size
   breakdown), filtered label list, mark-printed (by ids/product, idempotent),
   scan/lookup by code (billing reuses `lookupByCode`).
5. ✅ **Customer module:** CRUD + search; phone is unique (identity);
   `lookup?phone=` for the counter; `upsertByPhone` (find-or-create) reused by
   billing; delete blocked if any bill references the customer.
6. ✅ **Billing module:** scan → bill (subtotal = Σ MRP), %/₹ discount, split
   payments + change, customer upsert by phone. Create+complete and held-bill
   completion run in a transaction (assign invoice no., mark units sold, decrement
   stock). Hold/list/complete/discard; sold units can't be re-billed; history +
   full bill detail.
7. ✅ **Dashboard/reports (superadmin):** summary KPIs (+ today + counts),
   **day-wise sales** (IST buckets, gap-filled), payment-method & category pies,
   top products. All optional `from`/`to` date range. Sales = completed bills.
8. ⬜ **Frontend (React + MUI).**
