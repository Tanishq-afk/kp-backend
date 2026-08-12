import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Bill from '../src/models/Bill.js';
import Customer from '../src/models/Customer.js';
import User from '../src/models/User.js';

// ----------------------------------------------------------------------------
// One-time import of line-item historical bills ("Data/saleslist.xlsx" ->
// seed/data/saleslist.json). Unlike the older importBills.js (header-only, no
// line items), this sheet has one row per sold item, grouped by BillNumber.
//
//   BillNumber -> billNumber (prefixed "LEGACY-<n>" — the sheet's numbering is
//     just an export row-sequence, not a real invoice number, and must never
//     collide with the live app's "INV-######" sequence).
//   Per group: subtotal = Σ Total, discount = Σ Discount, total = Σ Netamt
//     (verified: Total - Discount == Netamt on every row). BillAmt is a
//     group-level total repeated on every line (like Netamt-sum, occasionally
//     inconsistent with it in the source) — ignored in favor of Σ Netamt.
//   PaymentMethod is identical across every row of a bill (verified) -> a
//     single payment line for the bill total. Cash -> cash, Wallet -> upi,
//     Card -> card.
//   Items are denormalized snapshots only (productName, mrp = Total, qty) —
//     there's no reliable per-unit Barcode to link (name-only source data),
//     so `items[].barcode` (schema-required) is intentionally omitted and the
//     insert goes through the native driver to bypass that validator, same
//     approach as the original importBills.js.
//   Customer linked by CustomerNumber (phone) when present; upserted.
//
// Idempotent: de-duplicated by billNumber.
//
// Usage:
//   python3 seed/convertSalesData.py
//   node seed/importSalesBills.js seed/data/saleslist.json
// ----------------------------------------------------------------------------

const str = (v) => String(v ?? '').trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cleanPhone = (p) => String(p ?? '').replace(/\D/g, '');

const PAYMENT_MAP = { Cash: 'cash', Wallet: 'upi', Card: 'card' };

const main = async () => {
  const jsonPath = process.argv[2] || 'seed/data/saleslist.json';
  if (!fs.existsSync(jsonPath)) {
    console.error(`Usage: node seed/importSalesBills.js <saleslist.json>\n(run seed/convertSalesData.py first if it doesn't exist)`);
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Loaded ${rows.length} rows from ${jsonPath}`);

  // --- group by the sheet's BillNumber ---
  const groups = new Map();
  for (const r of rows) {
    if (r.BillNumber == null || !r.billDateTime) continue;
    if (!groups.has(r.BillNumber)) groups.set(r.BillNumber, []);
    groups.get(r.BillNumber).push(r);
  }
  console.log(`Grouped into ${groups.size} bills`);

  await connectDB();
  try {
    const admin = await User.findOne({ role: 'admin' });
    const createdBy = admin?._id;

    const allBillNumbers = [...groups.keys()].map((n) => `LEGACY-${n}`);
    const existing = new Set(await Bill.distinct('billNumber', { billNumber: { $in: allBillNumbers } }));

    const customers = await Customer.find({}, 'name phone');
    const byPhone = new Map(customers.map((c) => [c.phone, c]));

    let linked = 0;
    let createdCustomers = 0;
    let skipped = 0;
    let badPaymentMethod = 0;
    const docs = [];
    // remember each bill's rows for the returns importer to reuse for matching
    const billLookup = []; // { sheetBillNumber, mongoBillNumberRef set after insert }

    for (const [billNo, items] of groups) {
      const billNumber = `LEGACY-${billNo}`;
      if (existing.has(billNumber)) {
        skipped += 1;
        continue;
      }

      const first = items[0];
      const subtotal = items.reduce((s, r) => s + num(r.Total), 0);
      const discount = items.reduce((s, r) => s + num(r.Discount), 0);
      const total = items.reduce((s, r) => s + num(r.Netamt), 0);

      const phone = cleanPhone(first.CustomerNumber);
      let customer = null;
      if (phone) {
        let c = byPhone.get(phone);
        if (!c) {
          c = await Customer.create({ name: str(first.CustomerName) || 'Customer', phone, createdBy });
          byPhone.set(phone, c);
          createdCustomers += 1;
        }
        customer = c._id;
        linked += 1;
      }

      const method = PAYMENT_MAP[first.PaymentMethod];
      if (!method) badPaymentMethod += 1;

      const createdAt = new Date(first.billDateTime);
      const billItems = items.map((r) => ({
        productName: str(r.ItemName),
        mrp: num(r.Total),
      }));

      docs.push({
        billNumber,
        status: 'completed',
        customer,
        customerName: str(first.CustomerName),
        customerPhone: phone,
        items: billItems,
        subtotal,
        discountType: 'flat',
        discountValue: discount,
        discount,
        tax: 0,
        total,
        payments: [{ method: method || 'cash', amount: total }],
        amountPaid: total,
        changeReturned: 0,
        paymentStatus: 'paid',
        remarks: badPaymentMethod && !method ? 'legacy import: unrecognized payment method, defaulted to cash' : '',
        createdBy,
        createdAt,
        updatedAt: createdAt,
      });
    }

    if (docs.length) {
      // native driver: bypasses the items[].barcode-required validator and
      // keeps our explicit historical createdAt/updatedAt (Mongoose would
      // otherwise overwrite them with "now").
      await Bill.collection.insertMany(docs);
    }
    console.log(`Inserted ${docs.length} bills (skipped ${skipped} already present).`);
    console.log(`Customer links: ${linked} by phone (${createdCustomers} new customers).`);
    if (badPaymentMethod) console.log(`⚠ ${badPaymentMethod} bills had an unrecognized PaymentMethod, defaulted to cash.`);
  } catch (err) {
    console.error('Import error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

main();
