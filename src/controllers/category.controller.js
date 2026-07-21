import asyncHandler from '../utils/asyncHandler.js';
import * as categoryService from '../services/category.service.js';

// POST /api/categories (admin)
export const create = asyncHandler(async (req, res) => {
  const category = await categoryService.createCategory(req.body, req.user);
  res.status(201).json({ success: true, data: category });
});

// GET /api/categories
export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await categoryService.listCategories(req.query);
  res.json({ success: true, data: items, pagination });
});

// GET /api/categories/:id
export const getOne = asyncHandler(async (req, res) => {
  const category = await categoryService.getCategory(req.params.id);
  res.json({ success: true, data: category });
});

// PATCH /api/categories/:id (admin)
export const update = asyncHandler(async (req, res) => {
  const category = await categoryService.updateCategory(req.params.id, req.body);
  res.json({ success: true, data: category });
});

// DELETE /api/categories/:id (admin)
export const remove = asyncHandler(async (req, res) => {
  const data = await categoryService.deleteCategory(req.params.id);
  res.json({ success: true, data });
});
