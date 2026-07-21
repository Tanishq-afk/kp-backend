import { Router } from 'express';
import { query } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE } from '../config/constants.js';
import * as dashboardController from '../controllers/dashboard.controller.js';

const router = Router();

// Dashboards / reports are superadmin-only (oversight).
router.use(protect, restrictTo(ROLE.SUPERADMIN));

// Shared optional date-range validators (YYYY-MM-DD or ISO).
const dateRange = [
  query('from').optional().isISO8601().withMessage('from must be a date (YYYY-MM-DD)'),
  query('to').optional().isISO8601().withMessage('to must be a date (YYYY-MM-DD)'),
];

router.get('/summary', dateRange, validate, dashboardController.summary);
router.get('/sales/daily', dateRange, validate, dashboardController.dailySales);
router.get('/sales/payment-methods', dateRange, validate, dashboardController.paymentMethods);
router.get('/sales/top-products', [...dateRange, query('limit').optional().isInt({ min: 1, max: 50 })], validate, dashboardController.topProducts);
router.get('/sales/by-category', dateRange, validate, dashboardController.salesByCategory);

export default router;
