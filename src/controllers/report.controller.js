import asyncHandler from '../utils/asyncHandler.js';
import * as dashboardService from '../services/dashboard.service.js';

// GET /api/reports/day-summary?date=YYYY-MM-DD — full sales + returns report for
// one calendar day (IST). Available to admin and superadmin.
export const daySummary = asyncHandler(async (req, res) => {
  const data = await dashboardService.getDaySummary(req.query);
  res.json({ success: true, data });
});
