import asyncHandler from '../utils/asyncHandler.js';
import * as returnService from '../services/return.service.js';

// GET /api/returns/lookup (admin) — completed bills matching bill no. / phone.
export const lookup = asyncHandler(async (req, res) => {
  const { items, pagination } = await returnService.lookupBills(req.query);
  res.json({ success: true, data: items, pagination });
});

// GET /api/returns/bill/:billId (admin) — bill items annotated for return.
export const returnableItems = asyncHandler(async (req, res) => {
  const data = await returnService.getReturnableItems(req.params.billId);
  res.json({ success: true, data });
});

// POST /api/returns (admin) — create a return / exchange (atomic).
export const create = asyncHandler(async (req, res) => {
  const data = await returnService.createReturn(req.body, req.user);
  res.status(201).json({ success: true, data });
});

// GET /api/returns (auth) — returns history.
export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await returnService.listReturns(req.query);
  res.json({ success: true, data: items, pagination });
});

// GET /api/returns/:id (auth) — full return detail.
export const getOne = asyncHandler(async (req, res) => {
  const data = await returnService.getReturn(req.params.id);
  res.json({ success: true, data });
});
