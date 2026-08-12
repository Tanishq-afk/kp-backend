import { Router } from 'express';
import { body, param } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE, PAYMENT_METHODS, DISCOUNT_TYPES } from '../config/constants.js';
import * as returnController from '../controllers/return.controller.js';

const router = Router();

const PHONE_RX = /^\+?\d{7,15}$/;

const createValidators = [
  body('originalBill').isMongoId().withMessage('A valid original bill id is required'),
  body('returnItems').isArray({ min: 1 }).withMessage('Select at least one item to return'),
  body('returnItems.*.barcode').isString().trim().notEmpty().withMessage('Invalid return item'),
  body('returnItems.*.resellable').optional().isBoolean().withMessage('resellable must be a boolean'),
  body('returnItems.*.labelLost').optional().isBoolean().withMessage('labelLost must be a boolean'),
  // optional exchange (new items being bought in the same transaction)
  body('newBarcodes').optional().isArray().withMessage('newBarcodes must be an array'),
  body('newBarcodes.*').optional().isString().trim().notEmpty().withMessage('Invalid barcode code'),
  // money for the new sale + settlement of the net
  body('discountType').optional().isIn(DISCOUNT_TYPES).withMessage(`discountType must be one of: ${DISCOUNT_TYPES.join(', ')}`),
  body('discountValue').optional().isFloat({ min: 0 }).withMessage('discountValue must be a number >= 0'),
  body('tax').optional().isFloat({ min: 0 }).withMessage('tax must be a number >= 0'),
  body('payments').optional().isArray().withMessage('payments must be an array'),
  body('payments.*.method').isIn(PAYMENT_METHODS).withMessage(`payment method must be one of: ${PAYMENT_METHODS.join(', ')}`),
  body('payments.*.amount').isFloat({ min: 0 }).withMessage('payment amount must be a number >= 0'),
  body('payments.*.reference').optional().trim(),
  body('customer').optional().isObject().withMessage('customer must be an object'),
  body('customer.name').if(body('customer').exists()).trim().notEmpty().withMessage('Customer name is required'),
  body('customer.phone').if(body('customer').exists()).matches(PHONE_RX).withMessage('A valid customer phone is required'),
  body('remarks').optional().trim(),
];

router.use(protect);

// --- lookup / returnable items (admin) ---
router.get('/lookup', restrictTo(ROLE.ADMIN), returnController.lookup);
router.get(
  '/bill/:billId',
  restrictTo(ROLE.ADMIN),
  [param('billId').isMongoId().withMessage('Invalid bill id')],
  validate,
  returnController.returnableItems
);

// create a return / exchange
router.post('/', restrictTo(ROLE.ADMIN), createValidators, validate, returnController.create);

// history (both roles) + detail
router.get('/', returnController.list);
router.get(
  '/:id',
  [param('id').isMongoId().withMessage('Invalid return id')],
  validate,
  returnController.getOne
);

export default router;
