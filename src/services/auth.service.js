import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { signToken } from '../utils/jwt.js';
import { ROLE } from '../config/constants.js';

// Returns a plain user object with the password stripped, safe to send back.
const toSafeUser = (user) => {
  const obj = user.toObject();
  delete obj.password;
  return obj;
};

// Validates credentials and returns a signed token + the safe user.
// Uses one generic message for both "no such user" and "wrong password" so we
// don't leak which emails exist.
export const login = async ({ email, password }) => {
  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  if (!user.isActive) {
    throw new ApiError(403, 'Your account has been deactivated.');
  }

  user.lastLogin = new Date();
  await user.save(); // password not modified -> not re-hashed

  const token = signToken({ id: user._id, role: user.role });
  return { token, user: toSafeUser(user) };
};

// Super-admin-only: creates a new admin account. Always creates role 'admin'
// (this endpoint never mints super admins).
export const registerAdmin = async ({ name, email, password, phone }, createdBy) => {
  const normalizedEmail = String(email).toLowerCase().trim();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new ApiError(409, 'A user with this email already exists.');
  }

  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    phone,
    role: ROLE.ADMIN,
    createdBy: createdBy?._id,
  });

  return toSafeUser(user);
};
