import mongoose from 'mongoose';
import Barcode from '../models/Barcode.js';
import Product from '../models/Product.js';
import ApiError from '../utils/ApiError.js';
import { getPagination, buildPage } from '../utils/paginate.js';

// The print queue: pending (not-yet-printed) barcodes grouped by product, with a
// per-size breakdown — i.e. the "table" the admin picks from to print labels.
export const getPrintQueue = async () => {
  return Barcode.aggregate([
    { $match: { printStatus: 'pending' } },
    // count per (product, size)
    {
      $group: {
        _id: { product: '$product', size: '$size' },
        productName: { $first: '$productName' },
        articleNumber: { $first: '$articleNumber' },
        category: { $first: '$category' },
        mrp: { $first: '$mrp' },
        count: { $sum: 1 },
      },
    },
    // roll up to one row per product
    {
      $group: {
        _id: '$_id.product',
        productName: { $first: '$productName' },
        articleNumber: { $first: '$articleNumber' },
        category: { $first: '$category' },
        mrp: { $first: '$mrp' },
        pendingCount: { $sum: '$count' },
        sizes: { $push: { size: '$_id.size', count: '$count' } },
      },
    },
    // attach the category name for display
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryDoc',
      },
    },
    {
      $project: {
        _id: 0,
        product: '$_id',
        productName: 1,
        articleNumber: 1,
        category: 1,
        categoryName: { $arrayElemAt: ['$categoryDoc.name', 0] },
        mrp: 1,
        pendingCount: 1,
        sizes: 1,
      },
    },
    { $sort: { productName: 1 } },
  ]);
};

// Filtered, paginated barcode list. The print UI uses
// `?product=<id>&printStatus=pending&limit=100` to fetch the actual label data.
// `code` / `search` does a partial, case-insensitive match against the
// scannable code OR the snapshotted product name — the barcode lookup/
// management listing uses this to find a unit by (fragment of) its printed
// number without knowing the exact full code.
export const listBarcodes = async (query) => {
  const filter = {};
  if (query.product) filter.product = query.product;
  if (query.status) filter.status = query.status;
  if (query.printStatus) filter.printStatus = query.printStatus;
  if (query.size) filter.size = query.size;
  const search = query.code || query.search;
  if (search) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ code: rx }, { productName: rx }];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Barcode.find(filter).sort({ serialNumber: 1 }).skip(skip).limit(limit),
    Barcode.countDocuments(filter),
  ]);
  return buildPage(items, total, { page, limit });
};

// Marks pending barcodes as printed — either an explicit set of ids, or all
// pending units of a product. Only 'pending' rows are touched, so it is safe to
// call again (idempotent).
export const markPrinted = async ({ ids, product }) => {
  let filter;
  if (Array.isArray(ids) && ids.length > 0) {
    filter = { _id: { $in: ids }, printStatus: 'pending' };
  } else if (product) {
    filter = { product, printStatus: 'pending' };
  } else {
    throw new ApiError(400, 'Provide either barcode ids or a product to mark printed.');
  }

  const result = await Barcode.updateMany(filter, { $set: { printStatus: 'printed' } });
  return { matched: result.matchedCount, modified: result.modifiedCount };
};

// Deletes a single barcode record — but never one that's been sold, so
// billing history stays intact (same protection deleteProduct already uses
// for the same reason). For an 'available' unit this also decrements the
// product's live stock count in the same transaction, since the physical
// unit it represented is being removed from tracking (e.g. a duplicate/
// erroneous barcode, or one for a unit that turned out not to exist).
export const deleteBarcode = async (id) => {
  const barcode = await Barcode.findById(id);
  if (!barcode) throw new ApiError(404, 'Barcode not found.');

  if (barcode.status === 'sold') {
    throw new ApiError(
      409,
      'This barcode has been sold and cannot be deleted — it is part of billing history.'
    );
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (barcode.status === 'available') {
        await Product.updateOne({ _id: barcode.product }, { $inc: { currentStock: -1 } }, { session });
      }
      await barcode.deleteOne({ session });
    });
  } finally {
    await session.endSession();
  }
  return { id };
};

// Scan / lookup a single barcode by its scannable code, with product + category
// context. Billing reuses this to add an item (and then enforces availability).
//
// Strips stray leading/trailing "*" — the Code39 start/stop guard characters
// used on pre-migration printed labels (imported via importItemlist.js). Most
// scanners already omit them, but this keeps lookup working either way; it's
// a no-op for normal KP-generated codes, which never contain "*".
export const lookupByCode = async (code) => {
  const cleaned = String(code).trim().replace(/^\*+|\*+$/g, '');
  const barcode = await Barcode.findOne({ code: cleaned })
    .populate('product', 'name articleNumber mrp currentStock isActive')
    .populate('category', 'name gender');
  if (!barcode) throw new ApiError(404, 'No barcode found for this code.');
  return barcode;
};
