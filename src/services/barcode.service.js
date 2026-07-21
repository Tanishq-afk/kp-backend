import Barcode from '../models/Barcode.js';
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
export const listBarcodes = async (query) => {
  const filter = {};
  if (query.product) filter.product = query.product;
  if (query.status) filter.status = query.status;
  if (query.printStatus) filter.printStatus = query.printStatus;
  if (query.size) filter.size = query.size;

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

// Scan / lookup a single barcode by its scannable code, with product + category
// context. Billing reuses this to add an item (and then enforces availability).
export const lookupByCode = async (code) => {
  const barcode = await Barcode.findOne({ code: String(code).trim() })
    .populate('product', 'name articleNumber mrp currentStock isActive')
    .populate('category', 'name gender');
  if (!barcode) throw new ApiError(404, 'No barcode found for this code.');
  return barcode;
};
