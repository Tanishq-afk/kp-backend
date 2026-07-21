import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Category from '../src/models/Category.js';
import Product from '../src/models/Product.js';
import Barcode from '../src/models/Barcode.js';
import User from '../src/models/User.js';
import { COUNTER } from '../src/config/constants.js';
import { reserveSequenceBlock } from '../src/utils/sequence.js';
import { buildBarcodeDocs } from '../src/utils/barcodeGenerator.js';

// ----------------------------------------------------------------------------
// One-time bulk import of the shop's existing catalog ("product list.xlsx").
// The export has no size/gender, and each row is a single unit, so:
//   row -> a free-size Product (qty = Quantity), ItemID -> articleNumber,
//          UnitCost -> costPrice, MRP -> mrp, gender inferred from category.
// Each product then gets one Barcode per unit (so it is billable).
//
// Idempotent: products are de-duplicated by articleNumber (ItemID); categories
// are find-or-create by name.
//
// Usage (the JSON is produced from the .xlsx via a small stdlib converter):
//   node seed/importProducts.js <products.json>
// ----------------------------------------------------------------------------

// Best-effort gender from the category name (Boys/Girls/NB=newborn/Lady...).
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

const num = (v) => Number(v) || 0;
const str = (v) => String(v ?? '').trim();

const main = async () => {
  const jsonPath = process.argv[2];
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    console.error('Usage: node seed/importProducts.js <products.json>');
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Loaded ${rows.length} rows from ${jsonPath}`);

  await connectDB();
  try {
    const admin = await User.findOne({ role: 'admin' });
    const createdBy = admin?._id;

    const clean = rows.filter((r) => str(r.ItemName) && str(r.ItemID) && str(r.CategoryName));

    // --- categories (find-or-create, gender inferred) ---
    const catNames = [...new Set(clean.map((r) => str(r.CategoryName)))];
    const catIdByName = new Map();
    let catsCreated = 0;
    for (const name of catNames) {
      // Case-insensitive match so casing variants (e.g. "Girls Shorts" vs
      // "GIRLS SHORTS") merge into one category, matching the unique index.
      let cat = await Category.findOne({ name }).collation({ locale: 'en', strength: 2 });
      if (!cat) {
        cat = await Category.create({ name, gender: inferGender(name), createdBy });
        catsCreated += 1;
      }
      catIdByName.set(name, cat._id);
    }
    console.log(`Categories: ${catNames.length} total (${catsCreated} created)`);

    // --- products (skip ones already imported by articleNumber) ---
    const itemIds = clean.map((r) => str(r.ItemID));
    const existing = new Set(await Product.distinct('articleNumber', { articleNumber: { $in: itemIds } }));
    const newRows = clean.filter((r) => !existing.has(str(r.ItemID)));
    console.log(`Products: ${clean.length} in file, ${existing.size} already in DB, ${newRows.length} to insert`);

    if (newRows.length === 0) {
      console.log('Nothing new to import.');
      return;
    }

    const productDocs = newRows.map((r) => {
      const qty = num(r.Quantity) || 1;
      return {
        name: str(r.ItemName),
        articleNumber: str(r.ItemID),
        category: catIdByName.get(str(r.CategoryName)),
        costPrice: num(r.UnitCost),
        mrp: num(r.MRP),
        sizeType: 'freesize',
        sizes: [{ size: 'Free Size', quantity: qty }],
        totalOpeningStock: qty,
        currentStock: qty,
        createdBy,
      };
    });

    const inserted = await Product.insertMany(productDocs, { ordered: false });
    console.log(`Inserted ${inserted.length} products`);

    // --- one barcode per unit ---
    const totalUnits = inserted.reduce((s, p) => s + p.sizes.reduce((a, z) => a + z.quantity, 0), 0);
    let serial = await reserveSequenceBlock(COUNTER.BARCODE, totalUnits);
    const barcodeDocs = [];
    for (const p of inserted) {
      const docs = buildBarcodeDocs(p, { startSerial: serial, createdBy });
      barcodeDocs.push(...docs);
      serial += docs.length;
    }

    const CHUNK = 1000;
    for (let i = 0; i < barcodeDocs.length; i += CHUNK) {
      await Barcode.insertMany(barcodeDocs.slice(i, i + CHUNK), { ordered: false });
    }
    console.log(`Created ${barcodeDocs.length} barcodes (print queue is now populated)`);
  } catch (err) {
    console.error('Import error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

main();
