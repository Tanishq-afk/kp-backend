import jwt from 'jsonwebtoken';

// Signs a JWT for an authenticated user. Env is read at call time so it is
// available after dotenv loads in server.js.
export const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// Verifies and decodes a JWT. Throws if invalid/expired (caller handles).
export const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET);
