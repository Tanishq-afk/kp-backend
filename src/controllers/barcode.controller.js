import asyncHandler from '../utils/asyncHandler.js';
import * as barcodeService from '../services/barcode.service.js';

// GET /api/barcodes/print-queue — pending labels grouped by product.
export const printQueue = asyncHandler(async (req, res) => {
  const data = await barcodeService.getPrintQueue();
  res.json({ success: true, data });
});

// GET /api/barcodes — filtered, paginated list (label data).
export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await barcodeService.listBarcodes(req.query);
  res.json({ success: true, data: items, pagination });
});

// POST /api/barcodes/print (admin) — mark barcodes printed by ids or product.
export const markPrinted = asyncHandler(async (req, res) => {
  const data = await barcodeService.markPrinted(req.body);
  res.json({ success: true, data });
});

// DELETE /api/barcodes/:id (admin) — delete one barcode record.
export const remove = asyncHandler(async (req, res) => {
  const data = await barcodeService.deleteBarcode(req.params.id);
  res.json({ success: true, data });
});

// GET /api/barcodes/:code — scan / lookup a single barcode.
export const lookup = asyncHandler(async (req, res) => {
  const barcode = await barcodeService.lookupByCode(req.params.code);
  res.json({ success: true, data: barcode });
});
