import asyncHandler from '../utils/asyncHandler.js';
import * as authService from '../services/auth.service.js';

// POST /api/auth/login — exchange credentials for a JWT.
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const data = await authService.login({ email, password });
  res.json({ success: true, data });
});

// POST /api/auth/register — super admin creates a new admin account.
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;
  const user = await authService.registerAdmin({ name, email, password, phone }, req.user);
  res.status(201).json({ success: true, data: user });
});

// GET /api/auth/me — the currently authenticated user.
export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user });
});
