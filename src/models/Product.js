import mongoose from 'mongoose';
import { SIZE_TYPES, sizesForType } from '../config/constants.js';

// One entry per size carried by the product, with its opening quantity.
//   e.g. { size: 'XL', quantity: 3 }
const sizeStockSchema = new mongoose.Schema(
  {
    size: { type: String, required: true, trim: true },
    quantity: {
      type: Number,
      required: true,
      min: [0, 'Quantity cannot be negative'],
    },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    // System-assigned (sequential, via the articleNumber counter) — never
    // typed by the admin, so this is safe to enforce as a real unique index.
    articleNumber: {
      type: String,
      required: [true, 'Article number is required'],
      trim: true,
      unique: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
    },
    // Unit cost / cost price (what the shop paid).
    costPrice: {
      type: Number,
      required: [true, 'Cost price is required'],
      min: [0, 'Cost price cannot be negative'],
    },
    // Maximum retail / selling price.
    mrp: {
      type: Number,
      required: [true, 'MRP is required'],
      min: [0, 'MRP cannot be negative'],
    },
    sizeType: {
      type: String,
      enum: SIZE_TYPES,
      required: [true, 'Size type is required'],
    },
    sizes: {
      type: [sizeStockSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one size with quantity is required',
      },
    },
    // Sum of opening quantities across all sizes (snapshot at creation).
    totalOpeningStock: {
      type: Number,
      default: 0,
    },
    // Live stock, decremented as units are billed.
    currentStock: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

// Validate that every size belongs to the chosen sizeType, and keep the stock
// totals in sync. currentStock is initialized to the opening stock only on the
// first save; later it is maintained by the billing/stock services.
productSchema.pre('validate', function validateSizes(next) {
  if (this.sizeType && Array.isArray(this.sizes)) {
    const allowed = sizesForType(this.sizeType);
    const invalid = this.sizes
      .map((s) => s.size)
      .filter((size) => !allowed.includes(String(size)));

    if (invalid.length > 0) {
      // Register as a proper validation error so the API returns 400.
      this.invalidate(
        'sizes',
        `Invalid size(s) [${invalid.join(', ')}] for size type "${this.sizeType}". ` +
          `Allowed: ${allowed.join(', ')}`
      );
    }

    const total = this.sizes.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
    this.totalOpeningStock = total;
    if (this.isNew) this.currentStock = total;
  }
  return next();
});

const Product = mongoose.model('Product', productSchema);

export default Product;
