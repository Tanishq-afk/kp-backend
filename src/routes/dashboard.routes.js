import { Router } from 'express';
import { query } from 'express-validator';
import { dateRangeValidators, requiredIstDate } from '../middleware/dateRange.js';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE } from '../config/constants.js';
import * as dashboardController from '../controllers/dashboard.controller.js';

const router = Router();

// Dashboards / reports are superadmin-only (oversight).
router.use(protect, restrictTo(ROLE.SUPERADMIN));

// Optional IST date-range validators (shared with the billing and returns lists).
const dateRange = dateRangeValidators;

router.get('/summary', dateRange, validate, dashboardController.summary);
router.get('/report', dateRange, validate, dashboardController.rangeReport);
// Both dates required: the statement is per day, so an open range is not meaningful.
router.get(
  '/account-statement',
  [
    query('from').custom(requiredIstDate('from')),
    query('to').custom(requiredIstDate('to')),
  ],
  validate,
  dashboardController.accountStatement
);
router.get('/sales/daily', dateRange, validate, dashboardController.dailySales);
router.get('/sales/payment-methods', dateRange, validate, dashboardController.paymentMethods);
router.get('/sales/top-products', [...dateRange, query('limit').optional().isInt({ min: 1, max: 50 })], validate, dashboardController.topProducts);
router.get('/sales/by-category', dateRange, validate, dashboardController.salesByCategory);
router.get('/stock/summary', dashboardController.stockSummary);
router.get('/stock/by-category', dashboardController.stockByCategory);

export default router;
