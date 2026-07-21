# KP Frontend — Build Brief & API Contract

> Portable context for building the **React + MUI** frontend (in its own repo,
> separate from `kp-backend`). Copy this file into the frontend project root (or
> keep both folders open) so the build session has the full backend contract.
> The backend is **feature-complete and seeded with real data**; this is the
> source of truth for endpoints, shapes, and enums.

---

## 1. Product overview
Inventory + sales/POS system for a clothing shop (Kidz Plaza). Two roles:
- **admin** — inventory (categories, products, barcode printing), customers, and
  the **billing counter** (scan → discount → split payment → hold/resume → complete).
- **superadmin** — oversight only: **dashboards & reports** (KPIs, day-wise sales,
  pie charts, top products). Cannot do inventory/billing.

Login is a single endpoint; the response includes `role` → the app routes to the
admin POS/inventory area or the superadmin dashboards accordingly.

## 2. Desired frontend stack & conventions (from the brief)
- **Vite + React + MUI (Material UI v5)**, mobile-responsive, nice modern UI.
- **Routing:** `react-router-dom` v6 — **all routes defined in ONE place** (a
  central route config) with `ProtectedRoute` + role guards.
- **Server state / data fetching:** `@tanstack/react-query` + `axios`.
- **Forms:** `react-hook-form`. **Charts:** `@mui/x-charts` (or Recharts).
- **Toasts:** `notistack`. **Dates:** `dayjs`. **Token:** `jwt-decode`.
- **Modularity:** reusable components, **custom hooks per resource**, an **API
  function for every backend endpoint**, constants & utils in their own folders.

### Suggested folder structure
```
src/
  api/            # axios client + one module per resource (a fn per endpoint)
    client.js     #   axios instance: baseURL, Bearer interceptor, 401 handling
    auth.api.js  products.api.js  categories.api.js  barcodes.api.js
    customers.api.js  bills.api.js  dashboard.api.js
  app/            # providers (QueryClient, Theme, Auth, Snackbar), App root
  routes/         # central routes config + ProtectedRoute / RoleRoute
  config/         # constants.js (enums mirrored from backend §6), env.js
  context/        # AuthContext (token + user + login/logout)
  hooks/          # useAuth, useProducts, useCategories, useDebounce, ...
  components/     # reusable: DataTable, FormField, ConfirmDialog, PageHeader,
                  #   MoneyText, StatCard, Barcode (JsBarcode), EmptyState ...
  features/       # feature modules (or pages/): auth, dashboard, products,
                  #   categories, barcodes, customers, billing, bills
  layouts/        # AppLayout (responsive AppBar + Drawer), AuthLayout
  utils/          # format.js (currency/date), helpers.js
  theme/          # MUI theme (palette, typography, components)
```

### Conventions
- API layer returns `res.data` (the `{ success, data, pagination? }` envelope);
  hooks unwrap `data`. Centralize error toasts in the axios interceptor / query
  client `onError`.
- Mirror backend enums in `config/constants.js` (don't hardcode strings in views).
- Responsive: MUI `Grid`/`Stack`, `useMediaQuery`, a Drawer that collapses to a
  temporary drawer on mobile; tables → cards on small screens where it helps.

## 3. Connection & auth
- **Base URL:** `http://localhost:5050/api` (backend `PORT=5050`). Put it in
  `VITE_API_URL`. Health check: `GET http://localhost:5050/health`.
- **CORS:** backend allows `http://localhost:5173` (Vite default) via `CORS_ORIGINS`.
- **Auth:** JWT. Send `Authorization: Bearer <token>` on every protected call.
  Store token (localStorage); decode for role/expiry; clear + redirect on 401.
- **Dev login:** use the two seeded accounts (credentials live in the backend
  `.env` — superadmin + admin). Do **not** hardcode passwords in the frontend.

### Response envelopes (every endpoint)
- Success: `{ "success": true, "data": ... }` (+ `pagination` on list endpoints;
  a few add siblings like `barcodeCount` / `barcodes`).
- Error: `{ "success": false, "message": "...", "errors"?: ["..."] }`.
- Status codes: 400 validation, 401 unauthenticated, 403 wrong role, 404 not
  found, 409 conflict/duplicate.

## 4. API reference (build an api fn for each)

### Auth  `/api/auth`
| Method | Path | Access | Body / Query | Returns |
|---|---|---|---|---|
| POST | `/login` | public | `{ email, password }` | `{ token, user }` |
| GET  | `/me` | auth | — | `user` |
| POST | `/register` | superadmin | `{ name, email, password, phone? }` | `user` (exists; not needed for the 2 fixed accounts) |

`user` = `{ _id, name, email, role, phone, isActive, lastLogin, createdAt }`.

### Categories  `/api/categories`  (reads: any auth · writes: **admin**)
| Method | Path | Body / Query |
|---|---|---|
| GET | `/` | `?gender&isActive&search&page&limit` → list + pagination |
| GET | `/:id` | — |
| POST | `/` | `{ name, gender }` |
| PATCH | `/:id` | `{ name?, gender?, isActive? }` |
| DELETE | `/:id` | (409 if products reference it) |

`category` = `{ _id, name, gender, isActive, createdAt }`.

### Products  `/api/products`  (reads: any auth · writes: **admin**)
| Method | Path | Body / Query |
|---|---|---|
| GET | `/` | `?category&sizeType&isActive&search&page&limit` (category populated) |
| GET | `/:id` | → `{ data: product, barcodes: { total, available, sold, printPending } }` |
| POST | `/` | `{ name, articleNumber, category, costPrice, mrp, sizeType, sizes:[{size,quantity}] }` → `{ data: product, barcodeCount }` |
| PATCH | `/:id` | `{ name?, articleNumber?, costPrice?, mrp?, category?, isActive? }` (not sizes) |
| DELETE | `/:id` | (409 if any unit sold) |

`product` = `{ _id, name, articleNumber, category(ref|populated), costPrice, mrp,
sizeType, sizes:[{size,quantity}], totalOpeningStock, currentStock, isActive }`.
Creating a product auto-generates one barcode per unit.

### Barcodes  `/api/barcodes`  (reads: any auth · print: **admin**)
| Method | Path | Body / Query |
|---|---|---|
| GET | `/print-queue` | grouped pending labels: `[{ product, productName, articleNumber, category, categoryName, mrp, pendingCount, sizes:[{size,count}] }]` |
| GET | `/` | `?product&status&printStatus&size&page&limit` (label data) |
| POST | `/print` | `{ ids?:[barcodeId], product? }` → `{ matched, modified }` (mark printed) |
| GET | `/:code` | scan/lookup by code → barcode (+ populated product, category) |

`barcode` = `{ _id, code, serialNumber, product, productName, articleNumber,
category, mrp, size, status, printStatus, bill, soldAt }`. Label shows: product
name, size, category, **MRP**, serial number, and the scannable `code` (render
with JsBarcode).

### Customers  `/api/customers`  (reads: any auth · writes: **admin**)
| Method | Path | Body / Query |
|---|---|---|
| GET | `/lookup?phone=` | exact phone → `customer` or `null` (counter autofill) |
| GET | `/` | `?search&isActive&page&limit` |
| GET | `/:id` | — |
| POST | `/` | `{ name, phone, remarks? }` (phone unique → 409) |
| PATCH | `/:id` | `{ name?, phone?, remarks?, isActive? }` |
| DELETE | `/:id` | (409 if any bill references them) |

`customer` = `{ _id, name, phone, remarks, isActive, createdAt }`.

### Bills / Billing  `/api/bills`  (writes/held: **admin** · history reads: any auth)
| Method | Path | Body / Query |
|---|---|---|
| POST | `/` | create+complete: `{ barcodes:[code], customer?:{name,phone}, discountType?, discountValue?, tax?, payments?:[{method,amount,reference?}], remarks? }` |
| POST | `/hold` | same body → parks the bill (status `held`, gets `holdRef`, no invoice no., no stock change) |
| GET | `/held` | list parked bills |
| POST | `/:id/complete` | resume+finalize: `{ payments?, discountType?, discountValue?, tax?, barcodes?, customer?, remarks? }` |
| DELETE | `/:id` | discard a **held** bill (completed bills can't be deleted) |
| GET | `/` | history: `?status&paymentStatus&from&to&search&page&limit` (excludes held) |
| GET | `/:id` | full bill (customer populated) |

`bill` = `{ _id, billNumber, status, holdRef, heldAt, customer(ref|populated),
customerName, customerPhone, items:[{ barcode, product, productName, articleNumber,
size, mrp }], subtotal, discountType, discountValue, discount, tax, total,
payments:[{ method, amount, reference }], amountPaid, changeReturned,
paymentStatus, remarks, createdBy, createdAt }`.

**Counter flow (admin UI):** scan code → `GET /barcodes/:code` to validate/add →
enter customer (phone → `GET /customers/lookup`) → discount (% or ₹) → take split
payment → **complete** or **hold**. `total = subtotal − discount + tax`;
`subtotal = Σ item.mrp`. A sold barcode can't be billed again (409).

### Dashboard / Reports  `/api/dashboard`  (**superadmin only**)
All accept `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
| Method | Path | Returns |
|---|---|---|
| GET | `/summary` | `{ range, totals:{revenue,bills,itemsSold,discountGiven,taxCollected}, today:{revenue,bills}, counts:{activeProducts,customers,activeAdmins,heldBills} }` |
| GET | `/sales/daily` | `[{ date:'YYYY-MM-DD', revenue, bills, itemsSold }]` (IST, gap-filled when from&to given) — **line/bar chart** |
| GET | `/sales/payment-methods` | `[{ method, amount, count }]` — **pie** |
| GET | `/sales/top-products` | `[{ product, productName, articleNumber, qty, revenue }]` (`?limit`) |
| GET | `/sales/by-category` | `[{ category, categoryName, revenue, qty }]` — **pie** |

## 5. Suggested routes & screens
**Public:** `/login`.
**Admin** (layout with side nav): `/` (or `/billing` counter), `/products`,
`/products/new`, `/categories`, `/print-queue`, `/customers`, `/bills` (history),
`/bills/:id`, `/bills/held`.
**Superadmin:** `/dashboard` (KPI cards + day-wise line chart + payment & category
pies + top-products table), with date-range filter; read-only access to inventory
& bills if desired.
Central `routes/` config maps each path → element + required role; a `RoleRoute`
redirects the wrong role to its home.

## 6. Enums / constants (mirror in `config/constants.js`)
- `ROLES`: `superadmin`, `admin`
- `GENDERS`: `Male`, `Female`, `Unisex`, `Kids`
- `SIZE_TYPES`: `alpha`, `numeric`, `freesize`
  - `ALPHA_SIZES`: `XS,S,M,L,XL,XXL,XXXL`
  - `NUMERIC_SIZES`: `0,2,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42`
  - `FREE_SIZE`: `Free Size`
- `PAYMENT_METHODS`: `cash`, `card`, `upi`
- `DISCOUNT_TYPES`: `flat`, `percent`
- `BARCODE_STATUS`: `available`, `sold`, `returned`, `void`
- `PRINT_STATUS`: `pending`, `printed`
- `PAYMENT_STATUS`: `paid`, `partial`, `unpaid`
- `BILL_STATUS`: `held`, `completed`, `cancelled`, `refunded`
- Currency: INR (₹). Money values are plain numbers (rupees).

## 7. Seeded data available for the UI
~4,226 products (free-size, each with a barcode in the print queue) across 46
categories, ~994 customers, and ~83 historical bills (June 2026) — so lists,
search, the billing lookup, and the dashboards all have real data immediately.

## 8. Backend reference
Full backend spec/architecture in `kp-backend/CONTEXT.md`; conventions in
`kp-backend/CLAUDE.md`. Start backend: `npm run dev` (port 5050) after `npm run seed`.
