import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Category from '../src/models/Category.js';
import Product from '../src/models/Product.js';
import Barcode from '../src/models/Barcode.js';
import User from '../src/models/User.js';
import Counter from '../src/models/Counter.js';
import { COUNTER } from '../src/config/constants.js';

// ----------------------------------------------------------------------------
// One-time bulk import of the shop's CURRENT catalog with its REAL,
// already-printed barcodes ("Data/Itemlist.xlsx" -> seed/data/itemlist.json).
//
// Unlike the older `importProducts.js` (which minted brand-new KP-prefixed
// codes), this sheet carries the barcode value already stuck on physical
// stock (`Barcode` col, Code39 text like "*00004*"). We must reuse that exact
// value so scanning the physical label resolves to the item — we do NOT
// generate a new code. Each row is already unit-granular (Stock is 0/1), so:
//
//   row -> one free-size Product (qty = Stock) + exactly one Barcode, whose
//          `code` is the sheet's barcode with the Code39 guard asterisks
//          stripped (scanners emit the payload, not the start/stop chars) —
//          e.g. "*00004*" -> "00004". `barcode.service.lookupByCode` also
//          strips stray leading/trailing "*" defensively, in case a scanner
//          is ever configured to transmit them.
//
// Data-quality handling (flag counts at the end, don't silently vanish them):
//   - The sheet's last row is a spreadsheet total (blank itemid/barcode) -> skipped.
//   - 7 barcodes appear twice (identical row duplicated with different Stock)
//     -> collapsed to one, preferring the copy with Stock >= 1.
//   - 4 rows have Stock = -1 (data-entry error upstream) -> clamped to 0.
//   - Stock = 0 rows still become a Product (catalog completeness) and a
//     Barcode (so the physical label still resolves if scanned), but the
//     Barcode is inserted as `status: 'sold'` with no `bill` on record —
//     there's no line-item history to link it to (pre-migration). It just
//     can't be sold again until it's physically re-verified as in stock.
//
// Idempotent: rows are skipped if a Barcode with that code already exists in
// the DB, so it's safe to re-run after fixing bad rows in the sheet.
//
// Usage:
//   python3 seed/convertItemlist.py             # writes seed/data/itemlist.json
//   node seed/importItemlist.js seed/data/itemlist.json
// ----------------------------------------------------------------------------

const inferGender = (name = '') => {
  const n = name.toLowerCase();
  const boy = /\bboys?\b/.test(n);
  const girl = /\bgirls?\b/.test(n);
  if (boy && girl) return 'Unisex';
  if (boy) return 'Male';
  if (girl) return 'Female';
  if (/lad(y|ies)|saree|frock|panty|middy|skirt/.test(n)) return 'Female';
  if (/\bnb\b|newborn|month/.test(n)) return 'Kids';
  return 'Unisex';
};

const str = (v) => String(v ?? '').trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// "*00004*" -> "00004". Also tolerates a bare "00004" (no guard chars).
const normalizeBarcode = (raw) => str(raw).replace(/^\*+|\*+$/g, '');

const main = async () => {
  const jsonPath = process.argv[2] || 'seed/data/itemlist.json';
  if (!fs.existsSync(jsonPath)) {
    console.error(`Usage: node seed/importItemlist.js <itemlist.json>\n(run seed/convertItemlist.py first if it doesn't exist)`);
    process.exit(1);
  }
  const rawRows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Loaded ${rawRows.length} rows from ${jsonPath}`);

  // --- clean + normalize --------------------------------------------------
  const skippedIncomplete = [];
  const cleaned = [];
  for (const r of rawRows) {
    const code = normalizeBarcode(r.Barcode);
    if (!code || !str(r.ItemName) || !str(r.CategoryName) || !Number.isFinite(Number(r.mrp))) {
      skippedIncomplete.push(r);
      continue;
    }
    cleaned.push({
      itemid: r.itemid,
      categoryName: str(r.CategoryName),
      name: str(r.ItemName),
      costPrice: num(r.UnitCost),
      mrp: num(r.mrp),
      stock: Math.max(0, num(r.Stock)), // clamp negative (data-entry error) to 0
      code,
    });
  }

  // --- dedupe by barcode (7 known exact-duplicate rows in the sheet) ------
  const byCode = new Map();
  let dupCount = 0;
  for (const r of cleaned) {
    const existing = byCode.get(r.code);
    if (!existing) {
      byCode.set(r.code, r);
    } else {
      dupCount += 1;
      // prefer whichever copy shows stock in hand
      if (r.stock > existing.stock) byCode.set(r.code, r);
    }
  }
  const rows = [...byCode.values()];
  console.log(
    `Rows: ${rawRows.length} total, ${skippedIncomplete.length} skipped (missing name/category/mrp/barcode), ` +
      `${dupCount} duplicate-barcode rows collapsed, ${rows.length} to process`
  );

  await connectDB();
  try {
    const admin = await User.findOne({ role: 'admin' });
    const createdBy = admin?._id;
    if (!createdBy) {
      console.warn('⚠ No admin user found — run `npm run seed` first if you want createdBy set. Continuing without it.');
    }

    // --- categories (find-or-create, gender inferred) ---
    const catNames = [...new Set(rows.map((r) => r.categoryName))];
    const catIdByName = new Map();
    let catsCreated = 0;
    for (const name of catNames) {
      let cat = await Category.findOne({ name }).collation({ locale: 'en', strength: 2 });
      if (!cat) {
        cat = await Category.create({ name, gender: inferGender(name), createdBy });
        catsCreated += 1;
      }
      catIdByName.set(name, cat._id);
    }
    console.log(`Categories: ${catNames.length} total (${catsCreated} created)`);

    // --- skip rows whose barcode already exists in the DB (idempotent) ---
    const allCodes = rows.map((r) => r.code);
    const existingCodes = new Set();
    const CHUNK = 5000;
    for (let i = 0; i < allCodes.length; i += CHUNK) {
      const found = await Barcode.distinct('code', { code: { $in: allCodes.slice(i, i + CHUNK) } });
      found.forEach((c) => existingCodes.add(c));
    }
    const newRows = rows.filter((r) => !existingCodes.has(r.code));
    console.log(`Barcodes: ${rows.length} in file, ${existingCodes.size} already in DB, ${newRows.length} to insert`);

    if (newRows.length === 0) {
      console.log('Nothing new to import.');
      return;
    }

    // --- insert products (one free-size product per row) ---
    const productDocs = newRows.map((r) => ({
      name: r.name,
      articleNumber: str(r.itemid),
      category: catIdByName.get(r.categoryName),
      costPrice: r.costPrice,
      mrp: r.mrp,
      sizeType: 'freesize',
      sizes: [{ size: 'Free Size', quantity: r.stock }],
      totalOpeningStock: r.stock,
      currentStock: r.stock,
      createdBy,
    }));
    const inserted = await Product.insertMany(productDocs, { ordered: false });
    console.log(`Inserted ${inserted.length} products`);

    // --- one barcode per product, code = the sheet's real barcode ---
    let soldLegacyCount = 0;
    const barcodeDocs = inserted.map((p, i) => {
      const r = newRows[i];
      const available = r.stock >= 1;
      if (!available) soldLegacyCount += 1;
      return {
        code: r.code,
        serialNumber: Number(r.code) || i + 1,
        product: p._id,
        productName: p.name,
        articleNumber: p.articleNumber,
        category: p.category,
        mrp: p.mrp,
        size: 'Free Size',
        status: available ? 'available' : 'sold',
        printStatus: 'printed', // these labels are already printed and on the shelf
        createdBy,
      };
    });

    for (let i = 0; i < barcodeDocs.length; i += CHUNK) {
      await Barcode.insertMany(barcodeDocs.slice(i, i + CHUNK), { ordered: false });
    }
    console.log(
      `Created ${barcodeDocs.length} barcodes (${barcodeDocs.length - soldLegacyCount} available, ` +
        `${soldLegacyCount} marked sold — Stock was 0 in the sheet, no bill on record)`
    );

    // Advance the shared `barcode` counter past the highest imported number so
    // future auto-generated codes (new products created in-app) never reuse a
    // serialNumber that's already on a printed physical label.
    const maxImported = Math.max(...barcodeDocs.map((b) => b.serialNumber));
    await Counter.findOneAndUpdate({ _id: COUNTER.BARCODE }, { $max: { seq: maxImported } }, { upsert: true });
    console.log(`Barcode counter advanced to at least ${maxImported}`);
  } catch (err) {
    console.error('Import error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

main();
