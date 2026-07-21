import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES, ROLE } from '../config/constants.js';

// Admin / super admin accounts.
//  - admin     : owns inventory creation, stock management, and billing.
//  - superadmin: oversight only (dashboards, reports, manage admins).
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    // Never returned by default; explicitly .select('+password') when needed.
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ROLES,
      default: ROLE.ADMIN,
    },
    phone: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Which superadmin created this account (null for the seeded superadmin).
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lastLogin: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Hash the password whenever it is set or changed.
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  return next();
});

// Compares a plaintext candidate against the stored hash.
userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;
