import { Router } from 'express';
import { query } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE } from '../config/constants.js';
import * as reportController from '../controllers/report.controller.js';

const router = Router();

// Day-end reports are available to BOTH roles: admin (counter cash-up) and
// superadmin (oversight). This differs from /api/dashboard, which is oversight-only.
router.use(protect, restrictTo(ROLE.ADMIN, ROLE.SUPERADMIN));

router.get(
  '/day-summary',
  [query('date').optional().isISO8601().withMessage('date must be a date (YYYY-MM-DD)')],
  validate,
  reportController.daySummary
);

export default router;
