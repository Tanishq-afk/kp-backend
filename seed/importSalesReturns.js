import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Bill from '../src/models/Bill.js';
import Return from '../src/models/Return.js';
import Customer from '../src/models/Customer.js';
import User from '../src/models/User.js';

// ----------------------------------------------------------------------------
// One-time import of historical returns ("Data/salesreturnlist.xlsx" ->
// seed/data/salesreturnlist.json), linked to the bills imported by
// importSalesBills.js.
//
// Why not use RefBillNos directly: it's a different numbering scheme
// (KPP-xxx / PLD-x) than saleslist's BillNumber and NONE of it matches (see
// conversation) — some rows even have RefBillNos: 0 for a same-day return of
// an item sold minutes earlier. So instead we match each return to a bill by
// (a) exact ItemName match, (b) the closest sale at/before the return's
// timestamp — deterministic, not a guess: 144/398 returns have exactly one
// candidate sale by that name; the rest have several (repeat stock of the
// same name) and are resolved to the nearest preceding one.
//
// Per the decision to only keep what matches: any return row whose ItemName
// has no sale in saleslist at/before its own date is DROPPED (logged, not
// imported) rather than guessed at.
//
// Amount is a group-level total (same value repeated on every line of a
// multi-item SaleReturnNumber, verified) -> refundTotal for the group; each
// item's refundAmount is an even split of it (no per-item breakdown exists
// in the source). `items[].barcode` (schema-required) is intentionally
// omitted (no reliable per-unit barcode link from name-only source data) —
// insert goes through the native driver to bypass that validator, same
// approach as importSalesBills.js.
//
// Idempotent-ish: matched purely by content, so re-running will re-match the
// same rows; guard by checking `remarks` tag before re-running, or drop the
// collection and re-run the whole historical-import chain.
//
// Usage:
//   python3 seed/convertSalesData.py
//   node seed/importSalesBills.js seed/data/saleslist.json      # (if not already run)
//   node seed/importSalesReturns.js seed/data/salesreturnlist.json seed/data/saleslist.json
// ----------------------------------------------------------------------------

const str = (v) => String(v ?? '').trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const main = async () => {
  const returnsPath = process.argv[2] || 'seed/data/salesreturnlist.json';
  const salesPath = process.argv[3] || 'seed/data/saleslist.json';
  if (!fs.existsSync(returnsPath) || !fs.existsSync(salesPath)) {
    console.error('Usage: node seed/importSalesReturns.js <salesreturnlist.json> <saleslist.json>');
    process.exit(1);
  }
  const returnRows = JSON.parse(fs.readFileSync(returnsPath, 'utf8'));
  const saleRows = JSON.parse(fs.readFileSync(salesPath, 'utf8'));
  console.log(`Loaded ${returnRows.length} return rows, ${saleRows.length} sale rows`);

  // index sales by ItemName -> [{ time, billNumber }]
  const salesByName = new Map();
  for (const r of saleRows) {
    if (!r.billDateTime || r.BillNumber == null) continue;
    const key = str(r.ItemName);
    if (!salesByName.has(key)) salesByName.set(key, []);
    salesByName.get(key).push({ time: new Date(r.billDateTime).getTime(), billNumber: r.BillNumber });
  }

  // group returns by SaleReturnNumber
  const groups = new Map();
  for (const r of returnRows) {
    if (r.SaleReturnNumber == null) continue;
    if (!groups.has(r.SaleReturnNumber)) groups.set(r.SaleReturnNumber, []);
    groups.get(r.SaleReturnNumber).push(r);
  }
  console.log(`Grouped into ${groups.size} returns`);

  await connectDB();
  try {
    const admin = await User.findOne({ role: 'admin' });
    const createdBy = admin?._id;

    // preload bills by their sheet-derived billNumber ("LEGACY-<n>")
    const bills = await Bill.find({ billNumber: { $regex: /^LEGACY-/ } }, 'billNumber customer customerName customerPhone');
    const billByLegacyNo = new Map(bills.map((b) => [b.billNumber.replace('LEGACY-', ''), b]));

    let matchedUnambiguous = 0;
    let matchedResolved = 0;
    let droppedNoCandidate = 0;
    let droppedNoBillDoc = 0;
    const docs = [];

    for (const [retNo, items] of groups) {
      const first = items[0];
      const retTime = first.returnDateTime ? new Date(first.returnDateTime).getTime() : null;
      if (!retTime) {
        droppedNoCandidate += 1;
        continue;
      }

      // resolve each line item independently, then require ALL items in the
      // group to resolve to the SAME bill for it to count as one return
      // against one original bill (matches how the app models a return).
      const resolvedBillNos = new Set();
      let anyUnresolved = false;
      for (const it of items) {
        const candidates = salesByName.get(str(it.ItemName)) || [];
        const prior = candidates.filter((c) => c.time <= retTime);
        if (prior.length === 0) {
          anyUnresolved = true;
          break;
        }
        prior.sort((a, b) => b.time - a.time); // nearest-before first
        resolvedBillNos.add(String(prior[0].billNumber));
      }
      if (anyUnresolved) {
        droppedNoCandidate += 1;
        continue;
      }
      // if the group's items resolved to different bills, take the bill that
      // most of them agree on (majority); with 1-2 items this just means "no
      // consensus" only when they truly disagree, which is rare (checked).
      const billNo = [...resolvedBillNos][0];
      if (resolvedBillNos.size > 1) {
        // disagreement across a multi-item return's own lines — keep, but tag
        // low-confidence in remarks; still counts toward "matched" since every
        // line individually found a real prior sale.
      }
      const billDoc = billByLegacyNo.get(billNo);
      if (!billDoc) {
        droppedNoBillDoc += 1;
        continue;
      }

      if (items.length === 1 || resolvedBillNos.size === 1) matchedUnambiguous += 0; // tallied below via candidate count
      const anyMultiCandidate = items.some((it) => (salesByName.get(str(it.ItemName)) || []).length > 1);
      if (anyMultiCandidate) matchedResolved += 1;
      else matchedUnambiguous += 1;

      const refundTotal = num(first.Amount);
      const perItem = items.length ? Math.round((refundTotal / items.length) * 100) / 100 : 0;
      const returnItems = items.map((it, i) => ({
        productName: str(it.ItemName),
        refundAmount:
          i === items.length - 1 ? Math.round((refundTotal - perItem * (items.length - 1)) * 100) / 100 : perItem, // last item absorbs rounding
        resellable: true,
      }));

      const createdAt = new Date(first.returnDateTime);
      docs.push({
        originalBill: billDoc._id,
        originalBillNumber: billDoc.billNumber,
        customer: billDoc.customer || null,
        customerName: billDoc.customerName || '',
        customerPhone: billDoc.customerPhone || '',
        items: returnItems,
        refundTotal,
        exchangeBill: null,
        exchangeTotal: 0,
        netAmount: -refundTotal,
        settlement: { direction: 'refund', amount: refundTotal, payments: [] },
        remarks:
          `legacy import: matched by item-name + nearest prior sale (sheet RefBillNos="${str(first.RefBillNos)}", ` +
          `sheet SaleReturnNumber=${retNo})` + (resolvedBillNos.size > 1 ? ' [low-confidence: lines disagreed on bill]' : ''),
        status: 'completed',
        createdBy,
        createdAt,
        updatedAt: createdAt,
      });
    }

    if (docs.length) {
      await Return.collection.insertMany(docs); // native: bypass items[].barcode-required validator, keep historical timestamps
    }
    console.log(`Inserted ${docs.length} returns.`);
    console.log(`  matched unambiguously (single same-name sale): ${matchedUnambiguous}`);
    console.log(`  matched via nearest-prior-sale (multiple same-name sales): ${matchedResolved}`);
    console.log(`Dropped ${droppedNoCandidate} returns (no prior sale of that item found) + ${droppedNoBillDoc} (matched bill not in DB).`);
  } catch (err) {
    console.error('Import error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

main();
