import { Router } from 'express';
import { body, param } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE, GENDERS } from '../config/constants.js';
import * as categoryController from '../controllers/category.controller.js';

const router = Router();

// All category routes require authentication.
router.use(protect);

const idParam = [param('id').isMongoId().withMessage('Invalid category id')];

// Reads: any authenticated user (admin manages, superadmin oversees).
router.get('/', categoryController.list);
router.get('/:id', idParam, validate, categoryController.getOne);

// Writes: admin only.
router.post(
  '/',
  restrictTo(ROLE.ADMIN),
  [
    body('name').trim().notEmpty().withMessage('Category name is required'),
    body('gender').isIn(GENDERS).withMessage(`Gender must be one of: ${GENDERS.join(', ')}`),
  ],
  validate,
  categoryController.create
);

router.patch(
  '/:id',
  restrictTo(ROLE.ADMIN),
  [
    ...idParam,
    body('name').optional().trim().notEmpty().withMessage('Category name cannot be empty'),
    body('gender').optional().isIn(GENDERS).withMessage(`Gender must be one of: ${GENDERS.join(', ')}`),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  ],
  validate,
  categoryController.update
);

router.delete('/:id', restrictTo(ROLE.ADMIN), idParam, validate, categoryController.remove);

export default router;
