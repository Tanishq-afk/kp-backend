import { Router } from 'express';
import { body, param, query } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE } from '../config/constants.js';
import * as customerController from '../controllers/customer.controller.js';

const router = Router();

// 7–15 digits, optional leading +.
const PHONE_RX = /^\+?\d{7,15}$/;

router.use(protect);

const idParam = [param('id').isMongoId().withMessage('Invalid customer id')];

// Specific paths before the `/:id` route.
router.get(
  '/lookup',
  [query('phone').matches(PHONE_RX).withMessage('A valid phone number is required')],
  validate,
  customerController.lookup
);
router.get('/', customerController.list);
router.get('/:id', idParam, validate, customerController.getOne);

// Writes: admin only.
router.post(
  '/',
  restrictTo(ROLE.ADMIN),
  [
    body('name').trim().notEmpty().withMessage('Customer name is required'),
    body('phone').matches(PHONE_RX).withMessage('A valid phone number is required'),
    body('remarks').optional().trim(),
  ],
  validate,
  customerController.create
);

router.patch(
  '/:id',
  restrictTo(ROLE.ADMIN),
  [
    ...idParam,
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('phone').optional().matches(PHONE_RX).withMessage('A valid phone number is required'),
    body('remarks').optional().trim(),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  ],
  validate,
  customerController.update
);

router.delete('/:id', restrictTo(ROLE.ADMIN), idParam, validate, customerController.remove);

export default router;
