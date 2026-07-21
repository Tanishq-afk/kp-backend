import mongoose from 'mongoose';
import { BARCODE_STATUS, PRINT_STATUS } from '../config/constants.js';

// One document per *physical unit* of stock. Creating a product with
// sizes [{XL,3},{L,4}] generates 7 Barcode docs (3 XL + 4 L).
//
// The denormalized fields (productName, articleNumber, category, mrp, size) are
// snapshots taken at generation time so the printed label and any historical
// lookup stay correct even if the product is later edited.
const barcodeSchema = new mongoose.Schema(
  {
    // The scannable value rendered on the label (unique across all units).
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Sequential "barcode number" shown on the label (counter-backed).
    serialNumber: {
      type: Number,
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    // ---- label snapshots ----
    productName: { type: String, required: true },
    articleNumber: { type: String },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
    },
    mrp: { type: Number, required: true },
    size: { type: String, required: true },
    // ---- lifecycle ----
    status: {
      type: String,
      enum: BARCODE_STATUS,
      default: 'available',
      index: true,
    },
    printStatus: {
      type: String,
      enum: PRINT_STATUS,
      default: 'pending',
      index: true,
    },
    // Set when the unit is sold; a sold unit fails the availability check and
    // cannot be billed again.
    bill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
      default: null,
    },
    soldAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

const Barcode = mongoose.model('Barcode', barcodeSchema);

export default Barcode;
