import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Barcode from '../models/Barcode.js';
import ApiError from '../utils/ApiError.js';
import { COUNTER } from '../config/constants.js';
import { reserveSequenceBlock } from '../utils/sequence.js';
import { buildBarcodeDocs, countUnits } from '../utils/barcodeGenerator.js';
import { getPagination, buildPage } from '../utils/paginate.js';

// Create a product and, in the same transaction, generate one Barcode per unit
// of opening stock (e.g. XL:3 + L:4 => 7 barcodes). Product and barcodes commit
// together, so a failure never leaves a product without its barcodes.
export const createProduct = async (payload, createdBy) => {
  const categoryExists = await Category.exists({ _id: payload.category });
  if (!categoryExists) {
    throw new ApiError(400, 'Selected category does not exist.');
  }

  const session = await mongoose.startSession();
  let outcome;
  try {
    await session.withTransaction(async () => {
      const [product] = await Product.create(
        [
          {
            name: payload.name,
            articleNumber: payload.articleNumber,
            category: payload.category,
            costPrice: payload.costPrice,
            mrp: payload.mrp,
            sizeType: payload.sizeType,
            sizes: payload.sizes,
            createdBy: createdBy?._id,
          },
        ],
        { session }
      );

      let barcodeCount = 0;
      const units = countUnits(product.sizes);
      if (units > 0) {
        const startSerial = await reserveSequenceBlock(COUNTER.BARCODE, units, { session });
        const docs = buildBarcodeDocs(product, { startSerial, createdBy: createdBy?._id });
        await Barcode.insertMany(docs, { session });
        barcodeCount = docs.length;
      }

      outcome = { product, barcodeCount };
    });
  } finally {
    await session.endSession();
  }

  await outcome.product.populate('category', 'name gender');
  return outcome;
};

// List products with optional category / sizeType / isActive / search filters.
export const listProducts = async (query) => {
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.sizeType) filter.sizeType = query.sizeType;
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.search) {
    const rx = { $regex: String(query.search).trim(), $options: 'i' };
    filter.$or = [{ name: rx }, { articleNumber: rx }];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name gender')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter),
  ]);
  return buildPage(items, total, { page, limit });
};

// Get one product plus a live barcode summary (stock by status).
export const getProduct = async (id) => {
  const product = await Product.findById(id).populate('category', 'name gender');
  if (!product) throw new ApiError(404, 'Product not found.');

  const [total, available, sold, printPending] = await Promise.all([
    Barcode.countDocuments({ product: id }),
    Barcode.countDocuments({ product: id, status: 'available' }),
    Barcode.countDocuments({ product: id, status: 'sold' }),
    Barcode.countDocuments({ product: id, printStatus: 'pending' }),
  ]);

  return { product, barcodes: { total, available, sold, printPending } };
};

// Update product details only. Sizes / sizeType are intentionally not editable
// here because changing them would require generating/removing barcodes; that
// belongs to a dedicated stock-adjustment flow (later).
export const updateProduct = async (id, updates) => {
  const allowed = ['name', 'articleNumber', 'costPrice', 'mrp', 'category', 'isActive'];
  const patch = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }

  if (patch.category) {
    const exists = await Category.exists({ _id: patch.category });
    if (!exists) throw new ApiError(400, 'Selected category does not exist.');
  }

  const product = await Product.findByIdAndUpdate(id, patch, {
    new: true,
    runValidators: true,
  }).populate('category', 'name gender');
  if (!product) throw new ApiError(404, 'Product not found.');
  return product;
};

// Delete a product and its barcodes — but never if any unit has been sold, so
// sales history stays intact (deactivate such products instead).
export const deleteProduct = async (id) => {
  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, 'Product not found.');

  const soldExists = await Barcode.exists({ product: id, status: 'sold' });
  if (soldExists) {
    throw new ApiError(
      409,
      'Product has sold units and cannot be deleted. Deactivate it instead.'
    );
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Barcode.deleteMany({ product: id }, { session });
      await product.deleteOne({ session });
    });
  } finally {
    await session.endSession();
  }
  return { id };
};
