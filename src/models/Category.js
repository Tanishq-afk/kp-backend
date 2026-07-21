import mongoose from 'mongoose';
import { GENDERS } from '../config/constants.js';

// Product categories. A category is scoped by gender, so the same name can
// exist for different genders (e.g. "Shirts" for Male and Female).
const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
    },
    gender: {
      type: String,
      enum: GENDERS,
      required: [true, 'Gender is required'],
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

// A given (name, gender) pair is unique. Case-insensitive uniqueness is
// enforced via a collation index so "Shirts" and "shirts" collide.
categorySchema.index(
  { name: 1, gender: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

const Category = mongoose.model('Category', categorySchema);

export default Category;
