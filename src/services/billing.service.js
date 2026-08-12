import mongoose from 'mongoose';
import Bill from '../models/Bill.js';
import Barcode from '../models/Barcode.js';
import Product from '../models/Product.js';
import ApiError from '../utils/ApiError.js';
import { COUNTER } from '../config/constants.js';
import { getNextSequence } from '../utils/sequence.js';
import { getPagination, buildPage } from '../utils/paginate.js';
import { upsertByPhone } from './customer.service.js';
import { getFinancialYear, billCounterKey } from '../utils/financialYear.js';

// "KP-0001" — resets every financial year (1 April) because `seq` comes from a
// counter keyed per-FY (see billCounterKey), not the flat COUNTER.BILL.
export const formatBillNumber = (seq) => `KP-${String(seq).padStart(4, '0')}`;

// Map a barcode doc to a bill line item (snapshots so history stays accurate).
const toItem = (b) => ({
  barcode: b._id,
  product: b.product,
  productName: b.productName,
  articleNumber: b.articleNumber,
  size: b.size,
  mrp: b.mrp,
});

// Resolve scanned codes -> validated, available barcode docs (in scan order).
// Optionally bound to a transaction session for race-free re-validation.
export const resolveByCodes = async (codes, session) => {
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new ApiError(400, 'Scan at least one barcode.');
  }
  const clean = codes.map((c) => String(c).trim());
  if (new Set(clean).size !== clean.length) {
    throw new ApiError(400, 'The same barcode was scanned more than once.');
  }

  const q = Barcode.find({ code: { $in: clean } });
  if (session) q.session(session);
  const found = await q;

  if (found.length !== clean.length) {
    const ok = new Set(found.map((b) => b.code));
    throw new ApiError(400, `Unknown barcode(s): ${clean.filter((c) => !ok.has(c)).join(', ')}`);
  }
  const unavailable = found.filter((b) => b.status !== 'available');
  if (unavailable.length) {
    throw new ApiError(409, `Already sold / unavailable: ${unavailable.map((b) => b.code).join(', ')}`);
  }

  const byCode = new Map(found.map((b) => [b.code, b]));
  const ordered = clean.map((c) => byCode.get(c));
  return { items: ordered.map(toItem), barcodeDocs: ordered };
};

// Re-validate a held bill's existing items by their barcode ids.
const resolveByIds = async (ids, session) => {
  if (!ids?.length) throw new ApiError(400, 'This bill has no items.');
  const q = Barcode.find({ _id: { $in: ids } });
  if (session) q.session(session);
  const found = await q;

  if (found.length !== ids.length) {
    throw new ApiError(409, 'Some items on this bill no longer exist.');
  }
  const unavailable = found.filter((b) => b.status !== 'available');
  if (unavailable.length) {
    throw new ApiError(409, `No longer available: ${unavailable.map((b) => b.code).join(', ')}`);
  }
  return { items: found.map(toItem), barcodeDocs: found };
};

// Compute money fields from items + discount/tax/payments. `appliedCredit` is
// return-credit tendered toward the bill (0 for a normal sale); it counts toward
// amountPaid alongside real payments so an exchange bill reads as fully paid.
export const computeAmounts = ({
  items,
  discountType = 'flat',
  discountValue = 0,
  tax = 0,
  payments = [],
  appliedCredit = 0,
}) => {
  const subtotal = items.reduce((s, it) => s + it.mrp, 0);

  let discount =
    discountType === 'percent'
      ? Math.round((subtotal * (Number(discountValue) || 0)) / 100)
      : Number(discountValue) || 0;
  discount = Math.max(0, Math.min(discount, subtotal)); // never more than subtotal

  const taxAmt = Number(tax) || 0;
  const total = Math.max(0, subtotal - discount + taxAmt);
  const paid = (payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const amountPaid = paid + (Number(appliedCredit) || 0);
  const changeReturned = Math.max(0, amountPaid - total);

  let paymentStatus = 'unpaid';
  if (total === 0 || amountPaid >= total) paymentStatus = 'paid';
  else if (amountPaid > 0) paymentStatus = 'partial';

  return { subtotal, discount, tax: taxAmt, total, amountPaid, changeReturned, paymentStatus };
};

// Find-or-create the customer when name+number are entered at the counter. The
// optional `remarks` (the bill's note) overrides the customer's standing remark
// so the latest note surfaces in the customer list.
export const resolveCustomer = async (customer, user, remarks) => {
  if (!customer) return null;
  if (!customer.name || !customer.phone) {
    throw new ApiError(400, 'Customer requires both a name and a phone number.');
  }
  return upsertByPhone({ ...customer, remarks: remarks ?? customer.remarks }, user);
};

// Mark sold + stamp the bill on every billed unit.
export const markSold = async (barcodeDocs, billId, session) => {
  const ids = barcodeDocs.map((b) => b._id);
  await Barcode.updateMany(
    { _id: { $in: ids } },
    { $set: { status: 'sold', bill: billId, soldAt: new Date() } },
    { session }
  );
};

// Decrement each product's live stock by how many of its units were sold.
export const decrementStock = async (items, session) => {
  const counts = new Map();
  for (const it of items) {
    const key = String(it.product);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [productId, qty] of counts) {
    await Product.updateOne({ _id: productId }, { $inc: { currentStock: -qty } }, { session });
  }
};

// Build the common bill payload (amounts + customer + meta) for create/complete.
const buildBillFields = (payload, items, amounts, customer, user) => ({
  customer: customer?._id || null,
  customerName: customer?.name,
  customerPhone: customer?.phone,
  items,
  subtotal: amounts.subtotal,
  discountType: payload.discountType || 'flat',
  discountValue: payload.discountValue || 0,
  discount: amounts.discount,
  tax: amounts.tax,
  total: amounts.total,
  payments: payload.payments || [],
  amountPaid: amounts.amountPaid,
  changeReturned: amounts.changeReturned,
  paymentStatus: amounts.paymentStatus,
  remarks: payload.remarks,
  createdBy: user._id,
});

// The transactional core of a completed sale, bound to an existing session so it
// can join a larger transaction (e.g. the exchange leg of a return). Validates
// scans, assigns the invoice number, marks units sold, and decrements stock.
// `appliedCredit` / `returnRef` link the sale to a return that funded part of it.
export const completeSaleInSession = async (
  payload,
  customer,
  session,
  user,
  { appliedCredit = 0, returnRef = null } = {}
) => {
  const { items, barcodeDocs } = await resolveByCodes(payload.barcodes, session);
  const amounts = computeAmounts({ items, ...payload, appliedCredit });
  const financialYear = getFinancialYear();
  const seq = await getNextSequence(billCounterKey(financialYear), { session });

  const [bill] = await Bill.create(
    [
      {
        billNumber: formatBillNumber(seq),
        financialYear,
        status: 'completed',
        appliedCredit,
        returnRef,
        ...buildBillFields(payload, items, amounts, customer, user),
      },
    ],
    { session }
  );

  await markSold(barcodeDocs, bill._id, session);
  await decrementStock(items, session);
  return bill;
};

// Create AND complete a sale in one transaction: validate scans, build the bill,
// assign the invoice number, mark units sold, and decrement stock — atomically.
export const createBill = async (payload, user) => {
  const customer = await resolveCustomer(payload.customer, user, payload.remarks);

  const session = await mongoose.startSession();
  let billId;
  try {
    await session.withTransaction(async () => {
      const bill = await completeSaleInSession(payload, customer, session, user);
      billId = bill._id;
    });
  } finally {
    await session.endSession();
  }
  return getBill(billId);
};

// Park an in-progress bill: validates scans are available now, but assigns NO
// invoice number and makes NO stock change (units stay available).
export const holdBill = async (payload, user) => {
  const customer = await resolveCustomer(payload.customer, user, payload.remarks);
  const { items } = await resolveByCodes(payload.barcodes);
  const amounts = computeAmounts({ items, ...payload });
  const seq = await getNextSequence(COUNTER.HOLD);

  return Bill.create({
    status: 'held',
    holdRef: `HOLD-${seq}`,
    heldAt: new Date(),
    ...buildBillFields(payload, items, amounts, customer, user),
  });
};

export const listHeldBills = async () => {
  return Bill.find({ status: 'held' }).populate('customer', 'name phone').sort({ heldAt: -1 });
};

// Resume a held bill and finalize it. Payload may override customer / discount /
// tax / payments / remarks, and optionally replace the scanned items.
export const completeHeldBill = async (id, payload, user) => {
  const held = await Bill.findById(id);
  if (!held) throw new ApiError(404, 'Held bill not found.');
  if (held.status !== 'held') throw new ApiError(400, 'This bill is not on hold.');

  const customer = payload.customer
    ? await resolveCustomer(payload.customer, user, payload.remarks ?? held.remarks)
    : null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const { items, barcodeDocs } =
        Array.isArray(payload.barcodes) && payload.barcodes.length
          ? await resolveByCodes(payload.barcodes, session)
          : await resolveByIds(held.items.map((it) => it.barcode), session);

      const discountType = payload.discountType ?? held.discountType;
      const discountValue = payload.discountValue ?? held.discountValue;
      const tax = payload.tax ?? held.tax;
      const payments = payload.payments ?? held.payments;
      const amounts = computeAmounts({ items, discountType, discountValue, tax, payments });

      const financialYear = getFinancialYear();
      const seq = await getNextSequence(billCounterKey(financialYear), { session });
      held.billNumber = formatBillNumber(seq);
      held.financialYear = financialYear;
      held.status = 'completed';
      held.holdRef = null;
      held.heldAt = null;
      held.items = items;
      if (customer) {
        held.customer = customer._id;
        held.customerName = customer.name;
        held.customerPhone = customer.phone;
      }
      held.subtotal = amounts.subtotal;
      held.discountType = discountType;
      held.discountValue = discountValue;
      held.discount = amounts.discount;
      held.tax = amounts.tax;
      held.total = amounts.total;
      held.payments = payments;
      held.amountPaid = amounts.amountPaid;
      held.changeReturned = amounts.changeReturned;
      held.paymentStatus = amounts.paymentStatus;
      if (payload.remarks !== undefined) held.remarks = payload.remarks;

      await held.save({ session });
      await markSold(barcodeDocs, held._id, session);
      await decrementStock(items, session);
    });
  } finally {
    await session.endSession();
  }
  return getBill(id);
};

// Discard a parked bill (held bills only; completed bills are permanent).
export const discardHeldBill = async (id) => {
  const bill = await Bill.findById(id);
  if (!bill) throw new ApiError(404, 'Bill not found.');
  if (bill.status !== 'held') throw new ApiError(400, 'Only held bills can be discarded.');
  await bill.deleteOne();
  return { id };
};

// Billing history (excludes held bills by default). Supports status / payment /
// date-range / text-search filters + pagination.
export const listBills = async (query) => {
  const filter = {};
  filter.status = query.status || { $ne: 'held' };
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.financialYear) filter.financialYear = query.financialYear;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) {
      const t = new Date(query.to);
      t.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = t;
    }
  }
  if (query.search) {
    const rx = { $regex: String(query.search).trim(), $options: 'i' };
    filter.$or = [{ billNumber: rx }, { customerName: rx }, { customerPhone: rx }];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Bill.find(filter).populate('customer', 'name phone').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Bill.countDocuments(filter),
  ]);
  return buildPage(items, total, { page, limit });
};

export const getBill = async (id) => {
  const bill = await Bill.findById(id).populate('customer', 'name phone remarks');
  if (!bill) throw new ApiError(404, 'Bill not found.');
  return bill;
};
