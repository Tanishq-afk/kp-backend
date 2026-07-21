import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Bill from '../src/models/Bill.js';
import Customer from '../src/models/Customer.js';
import User from '../src/models/User.js';

// ----------------------------------------------------------------------------
// One-time import of historical bills ("bill.xlsx" — a header-level Daily Sale
// Report; no line items). Each row -> a completed Bill with:
//   BillNumber -> billNumber, Total -> subtotal, Discount -> discount,
//   BillAmount -> total, Cash/Card/Wallet -> split payments (wallet = upi),
//   OrderDate (Excel serial) -> createdAt (so day-wise reports are correct).
//
// Customer reference is preserved: linked by a bracketed phone in the name
// (e.g. "RAJAN [8264550000]") — creating the customer if missing — otherwise by
// an exact name match against existing customers; the name is always snapshotted.
//
// items is left empty (the source has no line detail). Inserted via the native
// driver to bypass the items-required validator and keep historical timestamps.
// Idempotent: de-duplicated by billNumber.
//
// Usage: node seed/importBills.js <bills.json>
// ----------------------------------------------------------------------------

const str = (v) => String(v ?? '').trim();
const num = (v) => Number(v) || 0;
const cleanPhone = (p) => String(p ?? '').replace(/\D/g, '');
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const excelToDate = (serial) => new Date(EXCEL_EPOCH + Math.round(num(serial)) * 86400000);

// "RAJAN [8264550000]" -> { name: "RAJAN", phone: "8264550000" }
const parseName = (raw) => {
  const s = str(raw);
  const m = s.match(/\[([^\]]+)\]/);
  return {
    name: s.replace(/\[[^\]]*\]/, '').replace(/\s+/g, ' ').trim(),
    phone: m ? cleanPhone(m[1]) : '',
  };
};

const buildPayments = (d) => {
  const out = [];
  if (num(d.CashAmount) > 0) out.push({ method: 'cash', amount: num(d.CashAmount) });
  if (num(d.CardAmount) > 0) out.push({ method: 'card', amount: num(d.CardAmount) });
  if (num(d.WalletAmount) > 0) {
    const ref = str(d.WalletName);
    out.push({ method: 'upi', amount: num(d.WalletAmount), ...(ref && ref !== 'None' ? { reference: ref } : {}) });
  }
  return out;
};

const main = async () => {
  const jsonPath = process.argv[2];
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    console.error('Usage: node seed/importBills.js <bills.json>');
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Loaded ${rows.length} rows from ${jsonPath}`);

  await connectDB();
  try {
    const admin = await User.findOne({ role: 'admin' });
    const createdBy = admin?._id;

    const existingBills = new Set(
      await Bill.distinct('billNumber', { billNumber: { $in: rows.map((r) => str(r.BillNumber)) } })
    );

    // preload customers for matching
    const customers = await Customer.find({}, 'name phone');
    const byPhone = new Map(customers.map((c) => [c.phone, c]));
    const byName = new Map();
    for (const c of customers) {
      const k = c.name.trim().toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(c);
    }

    let linkedPhone = 0;
    let linkedName = 0;
    let unlinked = 0;
    let createdCustomers = 0;
    let skipped = 0;
    const docs = [];

    for (const d of rows) {
      const billNumber = str(d.BillNumber);
      if (!billNumber || existingBills.has(billNumber)) {
        skipped += 1;
        continue;
      }

      const { name, phone } = parseName(d.CustomerName);
      let customer = null;
      let customerPhone = '';

      if (phone) {
        let c = byPhone.get(phone);
        if (!c) {
          c = await Customer.create({ name: name || 'Customer', phone, createdBy });
          byPhone.set(phone, c);
          createdCustomers += 1;
        }
        customer = c._id;
        customerPhone = phone;
        linkedPhone += 1;
      } else if (name) {
        const matches = byName.get(name.toLowerCase());
        if (matches && matches.length === 1) {
          customer = matches[0]._id;
          customerPhone = matches[0].phone;
          linkedName += 1;
        } else {
          unlinked += 1;
        }
      } else {
        unlinked += 1;
      }

      const createdAt = excelToDate(d.OrderDate);
      docs.push({
        billNumber,
        status: 'completed',
        customer,
        customerName: name || '',
        customerPhone,
        items: [],
        subtotal: num(d.Total),
        discountType: 'flat',
        discountValue: num(d.Discount),
        discount: num(d.Discount),
        tax: 0,
        total: num(d.BillAmount),
        payments: buildPayments(d),
        amountPaid: num(d.PaidAmount),
        changeReturned: 0,
        paymentStatus: 'paid',
        remarks: str(d.Remarks),
        createdBy,
        createdAt,
        updatedAt: createdAt,
      });
    }

    if (docs.length) {
      await Bill.collection.insertMany(docs); // native: skip validation, keep timestamps
    }
    console.log(`Inserted ${docs.length} bills (skipped ${skipped} already present).`);
    console.log(
      `Customer links: ${linkedPhone} by phone (${createdCustomers} new customers), ` +
        `${linkedName} by name, ${unlinked} name-only (snapshot kept).`
    );
  } catch (err) {
    console.error('Import error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

main();
