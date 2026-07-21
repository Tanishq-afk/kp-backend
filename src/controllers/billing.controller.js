import asyncHandler from '../utils/asyncHandler.js';
import * as billingService from '../services/billing.service.js';

// POST /api/bills (admin) — create + complete a sale.
export const create = asyncHandler(async (req, res) => {
  const bill = await billingService.createBill(req.body, req.user);
  res.status(201).json({ success: true, data: bill });
});

// POST /api/bills/hold (admin) — park an in-progress bill.
export const hold = asyncHandler(async (req, res) => {
  const bill = await billingService.holdBill(req.body, req.user);
  res.status(201).json({ success: true, data: bill });
});

// GET /api/bills/held (admin) — list parked bills.
export const listHeld = asyncHandler(async (req, res) => {
  const data = await billingService.listHeldBills();
  res.json({ success: true, data });
});

// POST /api/bills/:id/complete (admin) — resume a held bill and finalize.
export const completeHeld = asyncHandler(async (req, res) => {
  const bill = await billingService.completeHeldBill(req.params.id, req.body, req.user);
  res.json({ success: true, data: bill });
});

// DELETE /api/bills/:id (admin) — discard a held bill.
export const discard = asyncHandler(async (req, res) => {
  const data = await billingService.discardHeldBill(req.params.id);
  res.json({ success: true, data });
});

// GET /api/bills — billing history (auth).
export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await billingService.listBills(req.query);
  res.json({ success: true, data: items, pagination });
});

// GET /api/bills/:id — full bill (auth).
export const getOne = asyncHandler(async (req, res) => {
  const bill = await billingService.getBill(req.params.id);
  res.json({ success: true, data: bill });
});
