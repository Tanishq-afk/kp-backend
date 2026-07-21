import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { verifyToken } from '../utils/jwt.js';
import User from '../models/User.js';

// Authenticates the request from a `Authorization: Bearer <jwt>` header and
// attaches the current user to `req.user`. Rejects missing/invalid tokens,
// deleted users, and deactivated accounts.
export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    throw new ApiError(401, 'Not authenticated. Please log in.');
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired token. Please log in again.');
  }

  const user = await User.findById(decoded.id);
  if (!user) {
    throw new ApiError(401, 'The account for this token no longer exists.');
  }
  if (!user.isActive) {
    throw new ApiError(403, 'Your account has been deactivated.');
  }

  req.user = user;
  return next();
});

// Restricts a route to one or more roles. Use after `protect`:
//   router.post('/register', protect, restrictTo(ROLE.SUPERADMIN), ...)
export const restrictTo = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(
      new ApiError(403, 'You do not have permission to perform this action.')
    );
  }
  return next();
};
