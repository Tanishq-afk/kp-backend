import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE } from '../config/constants.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

// Login is necessarily public (that's how a token is obtained at all), so it's
// the one endpoint an attacker can hammer without ever authenticating. The
// blanket /api limiter (300 req/15min) is far too loose to stop password
// guessing on its own — this caps login attempts specifically, per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again in a few minutes.' },
});

// Public: login.
router.post(
  '/login',
  loginLimiter,
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
