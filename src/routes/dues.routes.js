import { Router } from 'express';
import { body, param } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE, PAYMENT_METHODS } from '../config/constants.js';
import * as duesController from '../controllers/dues.controller.js';

const router = Router();

// Credit dues: both roles can see who owes what; only the admin records payments.
router.use(protect, restrictTo(ROLE.ADMIN, ROLE.SUPERADMIN));

router.get('/customers', duesController.outstanding);
router.get(
  '/customers/:customerId',
  [param('customerId').isMongoId().withMessage('Invalid customer id')],
  validate,
  duesController.customerDues
);
router.post(
  '/payments',
  restrictTo(ROLE.ADMIN),
  [
    body('customer').isMongoId().withMessage('A valid customer is required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be more than 0'),
    body('method').isIn(PAYMENT_METHODS).withMessage(`Method must be one of: ${PAYMENT_METHODS.join(', ')}`),
    body('reference').optional().trim(),
  ],
  validate,
  duesController.recordPayment
);

export default router;
