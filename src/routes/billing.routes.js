import { Router } from 'express';
import { body, param } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE, PAYMENT_METHODS, DISCOUNT_TYPES } from '../config/constants.js';
import * as billingController from '../controllers/billing.controller.js';

const router = Router();

const PHONE_RX = /^\+?\d{7,15}$/;
const idParam = [param('id').isMongoId().withMessage('Invalid bill id')];

// Discount / tax / split-payments / customer validators shared by create+hold.
const moneyValidators = [
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

const saleValidators = [
  body('barcodes').isArray({ min: 1 }).withMessage('Scan at least one barcode'),
  body('barcodes.*').isString().trim().notEmpty().withMessage('Invalid barcode code'),
  ...moneyValidators,
];

const completeValidators = [
  body('barcodes').optional().isArray().withMessage('barcodes must be an array'),
  body('barcodes.*').optional().isString().trim().notEmpty(),
  ...moneyValidators,
];

router.use(protect);

// --- specific paths before `/:id` ---
router.get('/held', restrictTo(ROLE.ADMIN), billingController.listHeld);
router.post('/hold', restrictTo(ROLE.ADMIN), saleValidators, validate, billingController.hold);

// create + complete a sale
router.post('/', restrictTo(ROLE.ADMIN), saleValidators, validate, billingController.create);

// history (both roles)
router.get('/', billingController.list);

// resume a held bill -> finalize
router.post('/:id/complete', restrictTo(ROLE.ADMIN), [...idParam, ...completeValidators], validate, billingController.completeHeld);

// read one + discard a held bill
router.get('/:id', idParam, validate, billingController.getOne);
router.delete('/:id', restrictTo(ROLE.ADMIN), idParam, validate, billingController.discard);

export default router;
