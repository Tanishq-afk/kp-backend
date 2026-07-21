import Category from '../models/Category.js';
import Product from '../models/Product.js';
import ApiError from '../utils/ApiError.js';
import { getPagination, buildPage } from '../utils/paginate.js';

// Create a category. The (name, gender) compound index enforces uniqueness;
// a duplicate surfaces as a 409 via the central error handler.
export const createCategory = async ({ name, gender }, createdBy) => {
  const category = await Category.create({ name, gender, createdBy: createdBy?._id });
  return category;
};

// List categories with optional gender / isActive / name-search filters.
export const listCategories = async (query) => {
  const filter = {};
  if (query.gender) filter.gender = query.gender;
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.search) filter.name = { $regex: String(query.search).trim(), $options: 'i' };

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Category.find(filter).sort({ gender: 1, name: 1 }).skip(skip).limit(limit),
    Category.countDocuments(filter),
  ]);
  return buildPage(items, total, { page, limit });
};

export const getCategory = async (id) => {
  const category = await Category.findById(id);
  if (!category) throw new ApiError(404, 'Category not found.');
  return category;
};

// Update mutable fields only.
export const updateCategory = async (id, updates) => {
  const allowed = ['name', 'gender', 'isActive'];
  const patch = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }

  const category = await Category.findByIdAndUpdate(id, patch, {
    new: true,
    runValidators: true,
  });
  if (!category) throw new ApiError(404, 'Category not found.');
  return category;
};

// Delete a category only if no products reference it; otherwise advise
// deactivation so historical products keep a valid category reference.
export const deleteCategory = async (id) => {
  const category = await Category.findById(id);
  if (!category) throw new ApiError(404, 'Category not found.');

  const inUse = await Product.exists({ category: id });
  if (inUse) {
    throw new ApiError(
      409,
      'Category is used by one or more products. Deactivate it instead of deleting.'
    );
  }

  await category.deleteOne();
  return { id };
};
