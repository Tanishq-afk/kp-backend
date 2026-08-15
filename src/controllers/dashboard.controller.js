import asyncHandler from '../utils/asyncHandler.js';
import * as dashboardService from '../services/dashboard.service.js';

// GET /api/dashboard/summary — KPI cards (+ today snapshot + counts).
export const summary = asyncHandler(async (req, res) => {
  const data = await dashboardService.getSummary(req.query);
  res.json({ success: true, data });
});

// GET /api/dashboard/sales/daily — day-wise sales series.
export const dailySales = asyncHandler(async (req, res) => {
  const data = await dashboardService.getDailySales(req.query);
  res.json({ success: true, data });
});

// GET /api/dashboard/sales/payment-methods — pie data by method.
export const paymentMethods = asyncHandler(async (req, res) => {
  const data = await dashboardService.getPaymentMethodBreakdown(req.query);
  res.json({ success: true, data });
});

// GET /api/dashboard/sales/top-products — best sellers.
export const topProducts = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const data = await dashboardService.getTopProducts(req.query, limit);
  res.json({ success: true, data });
});

// GET /api/dashboard/sales/by-category — pie data by category.
export const salesByCategory = asyncHandler(async (req, res) => {
  const data = await dashboardService.getSalesByCategory(req.query);
  res.json({ success: true, data });
});

// GET /api/dashboard/stock/summary — inventory KPIs (current stock, not sales).
export const stockSummary = asyncHandler(async (req, res) => {
  const data = await dashboardService.getStockSummary();
  res.json({ success: true, data });
});

// GET /api/dashboard/stock/by-category — current stock breakdown by category.
export const stockByCategory = asyncHandler(async (req, res) => {
  const data = await dashboardService.getStockByCategory();
  res.json({ success: true, data });
});
