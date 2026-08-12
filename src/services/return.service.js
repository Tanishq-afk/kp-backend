import mongoose from 'mongoose';
import Bill from '../models/Bill.js';
import Barcode from '../models/Barcode.js';
import Product from '../models/Product.js';
import Return from '../models/Return.js';
import Customer from '../models/Customer.js';
import ApiError from '../utils/ApiError.js';
import { COUNTER } from '../config/constants.js';
import { getNextSequence, reserveSequenceBlock } from '../utils/sequence.js';
import { buildBarcodeValue } from '../utils/barcodeGenerator.js';
import { getPagination, buildPage } from '../utils/paginate.js';
import {
  listBills,
  resolveByCodes,
  computeAmounts,
  completeSaleInSession,
  resolveCustomer,
} from './billing.service.js';

const formatReturnNumber = (seq) => `RET-${String(seq).padStart(6, '0')}`;

// The amount actually paid for one unit on a bill: its MRP share of the bill
// total, so a bill-level discount/tax is refunded proportionally.
const effectiveRefund = (bill, mrp) =>
  bill.subtotal > 0 ? Math.round((bill.total * mrp) / bill.subtotal) : 0;

// Lookup step 1: completed bills matching a bill number or customer phone/name.
// Thin wrapper over billing history, pinned to completed (only these have
// returnable units — a fully-returned bill is 'refunded' and excluded).
export const lookupBills = async (query) => {
  return listBills({ ...query, status: 'completed' });
};

// Lookup step 2: a bill's items annotated with whether each unit is still
// returnable (its barcode is 'sold' on this bill) and its per-unit refund value.
export const getReturnableItems = async (billId) => {
  const bill = await Bill.findById(billId).populate('customer', 'name phone');
  if (!bill) throw new ApiError(404, 'Bill not found.');
  if (bill.status === 'held') throw new ApiError(400, 'Held bills have no sale to return.');

  const barcodeIds = bill.items.map((it) => it.barcode).filter(Boolean);
  const barcodes = await Barcode.find({ _id: { $in: barcodeIds } }).select('_id status bill');
  const byId = new Map(barcodes.map((b) => [String(b._id), b]));

  const items = bill.items.map((it) => {
    const b = it.barcode ? byId.get(String(it.barcode)) : null;
    // Distinguish WHY an item isn't returnable — the UI shouldn't claim
    // "already returned" for a bill that never had unit-level tracking to
    // begin with (e.g. bills imported from historical records, name-only,
    // no barcode). `null` means it genuinely is returnable.
    let returnableReason = null;
    if (!it.barcode || !b) {
      returnableReason = 'no_unit_link'; // no barcode on this line — can't be processed as a return
    } else if (String(b.bill) !== String(bill._id) || b.status !== 'sold') {
      returnableReason = 'already_returned';
    }
    return {
      barcode: it.barcode,
      product: it.product,
      productName: it.productName,
      articleNumber: it.articleNumber,
      size: it.size,
      mrp: it.mrp,
      refundAmount: effectiveRefund(bill, it.mrp),
      returnable: returnableReason === null,
      returnableReason,
    };
  });

  return {
    bill: {
      _id: bill._id,
      billNumber: bill.billNumber,
      status: bill.status,
      customer: bill.customer || null,
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      subtotal: bill.subtotal,
      discount: bill.discount,
      total: bill.total,
      createdAt: bill.createdAt,
    },
    items,
  };
};

// Mint one fresh barcode per lost-label unit (the original label can't be
// scanned again, so a new one is generated for the SAME product and dropped into
// the print queue). Returns a Map(originalBarcodeId -> newBarcodeId).
const mintReplacements = async (reissue, user, session) => {
  const linkByOriginal = new Map();
  if (!reissue.length) return linkByOriginal;

  let serial = await reserveSequenceBlock(COUNTER.BARCODE, reissue.length, { session });
  const docs = reissue.map(({ barcode }) => ({
    code: buildBarcodeValue(serial),
    serialNumber: serial++,
    product: barcode.product,
    // snapshots copied from the original label so the reprint matches the unit
    productName: barcode.productName,
    articleNumber: barcode.articleNumber,
    category: barcode.category,
    mrp: barcode.mrp,
    size: barcode.size,
    status: 'available',
    printStatus: 'pending',
    createdBy: user?._id,
  }));
  const inserted = await Barcode.insertMany(docs, { session });
  reissue.forEach((x, i) => linkByOriginal.set(String(x.barcode._id), inserted[i]._id));
  return linkByOriginal;
};

// Bump each product's live stock by how many of its units came back in.
const restock = async (resellables, session) => {
  const counts = new Map();
  for (const { barcode } of resellables) {
    const k = String(barcode.product);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const [productId, qty] of counts) {
    await Product.updateOne({ _id: productId }, { $inc: { currentStock: qty } }, { session });
  }
};

// Create a sales return / exchange in one transaction: retire returned units,
// mint replacements for resellable ones (+restock), optionally sell scanned-in
// exchange items as a new bill, and settle the net.
export const createReturn = async (payload, user) => {
  const { originalBill, returnItems, newBarcodes } = payload;
  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw new ApiError(400, 'Select at least one item to return.');
  }
  const hasExchange = Array.isArray(newBarcodes) && newBarcodes.length > 0;

  // Customer override (if any) is upserted outside the transaction, matching the
  // billing flow; otherwise the return inherits the original bill's customer.
  const overrideCustomer = payload.customer
    ? await resolveCustomer(payload.customer, user, payload.remarks)
    : null;

  const session = await mongoose.startSession();
  let returnId;
  try {
    await session.withTransaction(async () => {
      // 1. Load + guard the original bill.
      const bill = await Bill.findById(originalBill).session(session);
      if (!bill) throw new ApiError(404, 'Original bill not found.');
      if (bill.status !== 'completed') {
        throw new ApiError(400, 'Only completed bills can be returned.');
      }
      const customer =
        overrideCustomer ||
        (bill.customer
          ? { _id: bill.customer, name: bill.customerName, phone: bill.customerPhone }
          : null);

      // Mirror the return's note onto the customer so the latest remark shows in
      // the customer list. An override already updated it via resolveCustomer;
      // here we cover the inherited-customer case (the common return path).
      const note = typeof payload.remarks === 'string' ? payload.remarks.trim() : '';
      if (note && !overrideCustomer && bill.customer) {
        await Customer.updateOne({ _id: bill.customer }, { $set: { remarks: note } }, { session });
      }

      // 2. Resolve requested units against the bill (accept barcode id or code).
      //    `labelLost` (resellable only) => the original label can't be scanned
      //    again, so mint a fresh barcode instead of reusing the original.
      const requested = returnItems.map((ri) => ({
        key: String(ri.barcode).trim(),
        resellable: ri.resellable !== false, // default: resellable
        labelLost: ri.resellable !== false && ri.labelLost === true,
      }));
      if (new Set(requested.map((r) => r.key)).size !== requested.length) {
        throw new ApiError(400, 'The same item was selected more than once.');
      }

      const billBarcodeIds = bill.items.map((it) => it.barcode).filter(Boolean);
      const billBarcodes = await Barcode.find({ _id: { $in: billBarcodeIds } }).session(session);
      const byIdStr = new Map(billBarcodes.map((b) => [String(b._id), b]));
      const byCode = new Map(billBarcodes.map((b) => [b.code, b]));
      const billItemByBarcode = new Map(bill.items.map((it) => [String(it.barcode), it]));

      const resolved = requested.map((r) => {
        const b = byIdStr.get(r.key) || byCode.get(r.key);
        if (!b) throw new ApiError(400, `Item not on this bill: ${r.key}`);
        return { barcode: b, resellable: r.resellable, labelLost: r.labelLost };
      });

      const notReturnable = resolved.filter(
        (x) => x.barcode.status !== 'sold' || String(x.barcode.bill) !== String(bill._id)
      );
      if (notReturnable.length) {
        throw new ApiError(
          409,
          `Not returnable (already returned, or not sold on this bill): ${notReturnable
            .map((x) => x.barcode.code)
            .join(', ')}`
        );
      }

      // 3. Build return items + refund amounts.
      const items = resolved.map(({ barcode, resellable, labelLost }) => {
        const mrp = billItemByBarcode.get(String(barcode._id))?.mrp ?? barcode.mrp;
        return {
          barcode: barcode._id,
          product: barcode.product,
          productName: barcode.productName,
          articleNumber: barcode.articleNumber,
          size: barcode.size,
          mrp,
          refundAmount: effectiveRefund(bill, mrp),
          resellable,
          labelLost,
          newBarcode: null,
        };
      });
      const refundTotal = items.reduce((s, it) => s + it.refundAmount, 0);

      // 4. Dispose of each returned unit's barcode:
      //    - resellable + label intact  -> reuse the SAME barcode: back to
      //      'available' (scan it again), clear its sold linkage.
      //    - resellable + label lost    -> retire the original, mint a fresh one.
      //    - damaged                    -> retire, not restocked.
      const resellables = resolved.filter((x) => x.resellable);
      const reuse = resellables.filter((x) => !x.labelLost);
      const reissue = resellables.filter((x) => x.labelLost);
      const retireIds = resolved
        .filter((x) => !x.resellable || x.labelLost)
        .map((x) => x.barcode._id);

      if (retireIds.length) {
        await Barcode.updateMany(
          { _id: { $in: retireIds } },
          { $set: { status: 'returned' } },
          { session }
        );
      }
      if (reuse.length) {
        await Barcode.updateMany(
          { _id: { $in: reuse.map((x) => x.barcode._id) } },
          { $set: { status: 'available', bill: null, soldAt: null } },
          { session }
        );
      }

      // 5. Mint replacements for lost labels, link them onto their items, and
      //    restock every resellable unit (reused + reissued).
      const linkByOriginal = await mintReplacements(reissue, user, session);
      for (const it of items) {
        const nb = linkByOriginal.get(String(it.barcode));
        if (nb) it.newBarcode = nb;
      }
      await restock(resellables, session);

      // 6. Optional exchange: sell scanned-in items as a normal bill. The net
      //    decides where money sits: a collect's cash goes on the exchange bill;
      //    a refund-out is recorded on the return's settlement.
      let exchangeBill = null;
      let exchangeTotal = 0;
      let settlementPayments = payload.payments || []; // default: refund-out (no exchange)

      if (hasExchange) {
        const { items: newItems } = await resolveByCodes(newBarcodes, session);
        const provisional = computeAmounts({
          items: newItems,
          discountType: payload.discountType,
          discountValue: payload.discountValue,
          tax: payload.tax,
        });
        const appliedCredit = Math.min(refundTotal, provisional.total);
        const collecting = provisional.total - refundTotal > 0;
        const collectPayments = collecting ? payload.payments || [] : [];
        settlementPayments = collecting ? [] : payload.payments || [];

        exchangeBill = await completeSaleInSession(
          {
            barcodes: newBarcodes,
            discountType: payload.discountType,
            discountValue: payload.discountValue,
            tax: payload.tax,
            remarks: payload.remarks,
            payments: collectPayments,
          },
          customer,
          session,
          user,
          { appliedCredit }
        );
        exchangeTotal = exchangeBill.total;
      }

      // 7. Net + settlement direction.
      const netAmount = exchangeTotal - refundTotal;
      let direction = 'even';
      if (netAmount > 0) direction = 'collect';
      else if (netAmount < 0) direction = 'refund';
      // No cash leaves the drawer unless we actually owe a refund.
      if (direction !== 'refund') settlementPayments = [];

      // 8. Create the return record, then link it back onto the exchange bill.
      const retSeq = await getNextSequence(COUNTER.RETURN, { session });
      const [returnDoc] = await Return.create(
        [
          {
            returnNumber: formatReturnNumber(retSeq),
            originalBill: bill._id,
            originalBillNumber: bill.billNumber,
            customer: customer?._id || null,
            customerName: customer?.name || bill.customerName,
            customerPhone: customer?.phone || bill.customerPhone,
            items,
            refundTotal,
            exchangeBill: exchangeBill?._id || null,
            exchangeTotal,
            netAmount,
            settlement: { direction, amount: Math.abs(netAmount), payments: settlementPayments },
            remarks: payload.remarks,
            createdBy: user._id,
          },
        ],
        { session }
      );
      returnId = returnDoc._id;

      if (exchangeBill) {
        await Bill.updateOne(
          { _id: exchangeBill._id },
          { $set: { returnRef: returnDoc._id } },
          { session }
        );
      }

      // 9. If no sold unit of the original bill remains, mark it refunded.
      const stillSold = await Barcode.findOne({ bill: bill._id, status: 'sold' })
        .select('_id')
        .session(session);
      if (!stillSold) {
        bill.status = 'refunded';
        await bill.save({ session });
      }
    });
  } finally {
    await session.endSession();
  }

  return getReturn(returnId);
};

// Returns history (newest first) — date range + text search + pagination.
export const listReturns = async (query) => {
  const filter = {};
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
    filter.$or = [
      { returnNumber: rx },
      { originalBillNumber: rx },
      { customerName: rx },
      { customerPhone: rx },
    ];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Return.find(filter)
      .populate('customer', 'name phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Return.countDocuments(filter),
  ]);
  return buildPage(items, total, { page, limit });
};

export const getReturn = async (id) => {
  const doc = await Return.findById(id)
    .populate('customer', 'name phone')
    .populate('originalBill', 'billNumber total status')
    .populate('exchangeBill', 'billNumber total paymentStatus');
  if (!doc) throw new ApiError(404, 'Return not found.');
  return doc;
};
