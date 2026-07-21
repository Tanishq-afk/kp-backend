import asyncHandler from '../utils/asyncHandler.js';
import * as customerService from '../services/customer.service.js';

// POST /api/customers (admin)
export const create = asyncHandler(async (req, res) => {
  const customer = await customerService.createCustomer(req.body, req.user);
  res.status(201).json({ success: true, data: customer });
});

// GET /api/customers
export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await customerService.listCustomers(req.query);
  res.json({ success: true, data: items, pagination });
});

// GET /api/customers/lookup?phone=... — returns the customer or null.
export const lookup = asyncHandler(async (req, res) => {
  const customer = await customerService.findByPhone(req.query.phone);
  res.json({ success: true, data: customer });
});

// GET /api/customers/:id
export const getOne = asyncHandler(async (req, res) => {
  const customer = await customerService.getCustomer(req.params.id);
  res.json({ success: true, data: customer });
});

// PATCH /api/customers/:id (admin)
export const update = asyncHandler(async (req, res) => {
  const customer = await customerService.updateCustomer(req.params.id, req.body);
  res.json({ success: true, data: customer });
});

// DELETE /api/customers/:id (admin)
export const remove = asyncHandler(async (req, res) => {
  const data = await customerService.deleteCustomer(req.params.id);
  res.json({ success: true, data });
});
