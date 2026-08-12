import mongoose from 'mongoose';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  BILL_STATUS,
  DISCOUNT_TYPES,
} from '../config/constants.js';

// A single line on a bill = one scanned barcode (physical unit). Product
// details are snapshotted so historical bills never change if a product is
// later edited or deleted. The unit's MRP is its line price; any discount is
// applied at the bill level (see discountType/discountValue below).
const billItemSchema = new mongoose.Schema(
  {
    barcode: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Barcode',
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    productName: { type: String, required: true },
    articleNumber: { type: String },
    size: { type: String },
    mrp: { type: Number, required: true }, // selling price of this unit
  },
  { _id: false }
);

// A split payment line: a bill can be paid across multiple methods.
const paymentSchema = new mongoose.Schema(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 0 },
    reference: { type: String, trim: true }, // txn id / card ref (optional)
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    // Human-readable invoice number (counter-backed). Assigned only when the
    // bill is completed — held bills have none yet, so the invoice sequence
    // stays gap-free. Uniqueness is enforced by a partial index (see below).
    billNumber: {
      type: String,
      default: null,
      required: [
        function billNumberRequired() {
          return this.status === 'completed';
        },
        'billNumber is required once a bill is completed',
      ],
    },
    // Indian financial year the bill was completed in, e.g. "2026-27" (Apr-Mar).
    // Drives per-year invoice numbering (KP-0001 resets every 1 April) and lets
    // history be filtered/segregated by year. Set at completion time, same as
    // billNumber — a held bill has neither yet.
    financialYear: { type: String, trim: true, index: true },
    // ---- hold / park ----
    // Short reference for a parked bill so the admin can find and resume it from
    // the held-bills list (e.g. "HOLD-12"). Cleared when the bill is completed.
    holdRef: { type: String, default: null, trim: true },
    heldAt: { type: Date, default: null },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    // Snapshots of the customer entered at billing time, so the billing history
    // table shows who the bill was for without a populate, and stays correct
    // even if the customer record is later edited or removed.
    customerName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    items: {
      type: [billItemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'A bill must have at least one item',
      },
    },
    // ---- amounts ----
    subtotal: { type: Number, required: true, min: 0 }, // sum of item mrp
    // Bill-level discount. `discountType` says whether the admin entered a flat
    // rupee amount or a percentage; `discountValue` is that raw entered number
    // (e.g. 10 => ₹10 or 10%); `discount` is the resolved rupee amount actually
    // applied (for percent it = round(subtotal * discountValue / 100)).
    discountType: { type: String, enum: DISCOUNT_TYPES, default: 'flat' },
    discountValue: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 }, // resolved discount in ₹
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 }, // subtotal - discount + tax
    // ---- split payments ----
    payments: { type: [paymentSchema], default: [] },
    // Return credit tendered toward this bill when it is the "buy" leg of an
    // exchange (see the Return model). Counts toward amountPaid alongside the
    // real payments, so an exchange bill still reads as fully paid even though
    // the customer only handed over the net difference in cash/card/upi.
    appliedCredit: { type: Number, default: 0, min: 0 },
    // Set when this bill was created as the exchange (new-purchase) leg of a
    // return, linking back to that return record.
    returnRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Return',
      default: null,
    },
    amountPaid: { type: Number, default: 0, min: 0 }, // sum of payments + appliedCredit
    changeReturned: { type: Number, default: 0, min: 0 },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUS,
      default: 'unpaid',
    },
    status: {
      type: String,
      enum: BILL_STATUS,
      default: 'completed',
    },
    // Free-text remarks the admin adds at billing time (shown in the billing
    // history table).
    remarks: { type: String, trim: true },
    // The admin who generated the bill.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// billNumber is unique only across bills that actually have one (completed
// bills); held bills store null and are excluded from this index.
billSchema.index(
  { billNumber: 1 },
  { unique: true, partialFilterExpression: { billNumber: { $type: 'string' } } }
);

// holdRef is unique only across currently-held bills.
billSchema.index(
  { holdRef: 1 },
  { unique: true, partialFilterExpression: { holdRef: { $type: 'string' } } }
);

// Drives the held-bills list and the billing history (newest first).
billSchema.index({ status: 1, createdAt: -1 });

const Bill = mongoose.model('Bill', billSchema);

export default Bill;
