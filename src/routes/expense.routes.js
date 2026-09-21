import { Router } from 'express';
import { body, query } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE } from '../config/constants.js';
import * as expenseController from '../controllers/expense.controller.js';

const router = Router();

// Both roles record expenses. Admins only see a single day's list (see the
// controller); the range filter, day-wise and monthly views are superadmin-only.
router.use(protect, restrictTo(ROLE.ADMIN, ROLE.SUPERADMIN));

const dateRange = [
  query('from').optional().isISO8601().withMessage('from must be a date (YYYY-MM-DD)'),
  query('to').optional().isISO8601().withMessage('to must be a date (YYYY-MM-DD)'),
  query('date').optional().isISO8601().withMessage('date must be a date (YYYY-MM-DD)'),
];

router.post(
  '/',
  [
    body('reason').trim().notEmpty().withMessage('Reason is required').isLength({ max: 200 }),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0').toFloat(),
  ],
  validate,
  expenseController.create
);
router.get('/', dateRange, validate, expenseController.list);
router.get('/daily', restrictTo(ROLE.SUPERADMIN), dateRange, validate, expenseController.daily);
router.get('/monthly', restrictTo(ROLE.SUPERADMIN), dateRange, validate, expenseController.monthly);

export default router;
