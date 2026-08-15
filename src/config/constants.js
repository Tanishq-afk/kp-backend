// ----------------------------------------------------------------------------
// Shared constants & enums used across models, validators, and services.
// Keep this as the single source of truth so the schema layer and (later) the
// frontend stay in sync.
// ----------------------------------------------------------------------------

// User roles
export const ROLES = ['superadmin', 'admin'];
export const ROLE = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
};

// Category gender buckets
export const GENDERS = ['Male', 'Female', 'Unisex', 'Kids'];

// ---- Size handling --------------------------------------------------------
// A product belongs to exactly one size type. Each entry in product.sizes must
// be a valid value for that product's sizeType.
export const SIZE_TYPES = ['alpha', 'numeric', 'freesize'];
export const SIZE_TYPE = {
  ALPHA: 'alpha',
  NUMERIC: 'numeric',
  FREESIZE: 'freesize',
};

export const ALPHA_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

// Numeric sizes: 0 and 2, then even sizes 10..42 (4, 6, 8 are not stocked).
export const NUMERIC_SIZES = [
  0,
  2,
  ...Array.from({ length: 17 }, (_, i) => 10 + i * 2), // 10, 12, ..., 42
];

export const FREE_SIZE = ['Free Size'];

// Returns the allowed size values for a given size type.
export const sizesForType = (sizeType) => {
  switch (sizeType) {
    case SIZE_TYPE.ALPHA:
      return ALPHA_SIZES;
    case SIZE_TYPE.NUMERIC:
      // numeric sizes are stored as strings on the product for consistency
      return NUMERIC_SIZES.map(String);
    case SIZE_TYPE.FREESIZE:
      return FREE_SIZE;
    default:
      return [];
  }
};

// ---- Payments -------------------------------------------------------------
export const PAYMENT_METHODS = ['cash', 'card', 'upi'];

// Bill-level discount: a flat rupee amount or a percentage of the subtotal.
export const DISCOUNT_TYPES = ['flat', 'percent'];

// ---- Status enums ---------------------------------------------------------
export const BARCODE_STATUS = ['available', 'sold', 'returned', 'void'];
export const PRINT_STATUS = ['pending', 'printed'];
export const PAYMENT_STATUS = ['paid', 'partial', 'unpaid'];
// 'held' = a parked/in-progress bill, set aside to serve another customer and
// resumed later. It has no invoice number and no stock impact until completed.
// 'refunded' = every sold unit on the bill has since been returned.
export const BILL_STATUS = ['held', 'completed', 'cancelled', 'refunded'];

// ---- Returns / exchanges --------------------------------------------------
// A return record is created atomically and is otherwise immutable ('void' is
// reserved for a future cancel-a-return flow).
export const RETURN_STATUS = ['completed', 'void'];
// How the net of an exchange settles: 'collect' = customer owes money (new items
// cost more than the return credit), 'refund' = shop pays money back, 'even' = no
// cash moves (credit exactly covers the new items).
export const SETTLEMENT_DIRECTIONS = ['collect', 'refund', 'even'];

// ---- Counter keys (atomic sequences) --------------------------------------
export const COUNTER = {
  BILL: 'bill',
  BARCODE: 'barcode',
  HOLD: 'hold',
  RETURN: 'return',
  ARTICLE_NUMBER: 'articleNumber',
};

// ---- Reporting -------------------------------------------------------------
// Timezone used to bucket day-wise sales (the shop is in India), so a "day"
// matches local business hours rather than UTC.
export const REPORT_TIMEZONE = 'Asia/Kolkata';

// Stock threshold below which an in-stock (>0) product counts as "low stock",
// for the superadmin stock-overview page and dashboard.
export const LOW_STOCK_THRESHOLD = 2;
