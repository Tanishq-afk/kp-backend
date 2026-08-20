import { Router } from 'express';
import { body, param } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { ROLE } from '../config/constants.js';
import * as barcodeController from '../controllers/barcode.controller.js';

const router = Router();

// All barcode routes require authentication.
router.use(protect);

// Specific paths first so they are not shadowed by the `/:code` lookup below.
router.get('/print-queue', barcodeController.printQueue);
router.get('/', barcodeController.list);

// Mark printed (admin). Accepts { ids: [...] } and/or { product: <id> }.
router.post(
  '/print',
  restrictTo(ROLE.ADMIN),
  [
    body('ids').optional().isArray().withMessage('ids must be an array'),
    body('ids.*').optional().isMongoId().withMessage('each id must be a valid barcode id'),
    body('product').optional().isMongoId().withMessage('product must be a valid id'),
  ],
  validate,
  barcodeController.markPrinted
);

// Delete one barcode (admin). Blocked for sold units — see service.
router.delete(
  '/:id',
  restrictTo(ROLE.ADMIN),
  [param('id').isMongoId().withMessage('Invalid barcode id')],
  validate,
  barcodeController.remove
);

// Scan / lookup by code — keep last (catch-all param, GET only so it
// doesn't shadow the DELETE /:id above).
router.get('/:code', barcodeController.lookup);

export default router;
