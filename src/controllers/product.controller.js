import asyncHandler from '../utils/asyncHandler.js';
import * as productService from '../services/product.service.js';

// POST /api/products (admin) — creates the product and its barcodes.
export const create = asyncHandler(async (req, res) => {
  const { product, barcodeCount } = await productService.createProduct(req.body, req.user);
  res.status(201).json({ success: true, data: product, barcodeCount });
});

// GET /api/products
export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await productService.listProducts(req.query);
  res.json({ success: true, data: items, pagination });
});

// GET /api/products/:id
export const getOne = asyncHandler(async (req, res) => {
  const { product, barcodes } = await productService.getProduct(req.params.id);
  res.json({ success: true, data: product, barcodes });
});

// PATCH /api/products/:id (admin)
export const update = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(req.params.id, req.body);
  res.json({ success: true, data: product });
});

// DELETE /api/products/:id (admin)
export const remove = asyncHandler(async (req, res) => {
  const data = await productService.deleteProduct(req.params.id);
  res.json({ success: true, data });
});
