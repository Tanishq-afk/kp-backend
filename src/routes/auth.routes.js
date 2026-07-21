import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE } from '../config/constants.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

// Public: login.
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('A valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  authController.login
);

// Super-admin-only: create a new admin account.
router.post(
  '/register',
  protect,
  restrictTo(ROLE.SUPERADMIN),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('phone').optional().trim(),
  ],
  validate,
  authController.register
);

// Authenticated: current user.
router.get('/me', protect, authController.me);

export default router;
