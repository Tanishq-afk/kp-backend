import { Router } from 'express';
import { body, param, query } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE, SIZE_TYPES } from '../config/constants.js';
import * as productController from '../controllers/product.controller.js';

const router = Router();

// All product routes require authentication.
router.use(protect);

const idParam = [param('id').isMongoId().withMessage('Invalid product id')];

// Reads: any authenticated user.
router.get(
  '/',
  [query('stockStatus').optional().isIn(['in', 'low', 'out']).withMessage('stockStatus must be one of: in, low, out')],
  validate,
  productController.list
);
router.get('/:id', idParam, validate, productController.getOne);

// Create (admin). articleNumber is system-assigned, not accepted from the
// client. The model additionally validates that each size value belongs to
// the chosen sizeType.
router.post(
  '/',
  restrictTo(ROLE.ADMIN),
  [
    body('name').trim().notEmpty().withMessage('Product name is required'),
    body('category').isMongoId().withMessage('A valid category is required'),
    body('costPrice').isFloat({ min: 0 }).withMessage('Cost price must be a number >= 0'),
    body('mrp').isFloat({ min: 0 }).withMessage('MRP must be a number >= 0'),
    body('sizeType').isIn(SIZE_TYPES).withMessage(`sizeType must be one of: ${SIZE_TYPES.join(', ')}`),
    body('sizes').isArray({ min: 1 }).withMessage('At least one size is required'),
    body('sizes.*.size').trim().notEmpty().withMessage('Each size must have a value'),
    body('sizes.*.quantity').isInt({ min: 0 }).withMessage('Each size quantity must be an integer >= 0'),
  ],
  validate,
  productController.create
);

// Update details (admin). Sizes/sizeType/articleNumber are not editable here.
router.patch(
  '/:id',
  restrictTo(ROLE.ADMIN),
  [
    ...idParam,
    body('name').optional().trim().notEmpty(),
    body('category').optional().isMongoId().withMessage('A valid category is required'),
    body('costPrice').optional().isFloat({ min: 0 }),
    body('mrp').optional().isFloat({ min: 0 }),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  productController.update
);

router.delete('/:id', restrictTo(ROLE.ADMIN), idParam, validate, productController.remove);

export default router;
