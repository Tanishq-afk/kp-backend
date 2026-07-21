import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import User from '../src/models/User.js';
import { ROLE } from '../src/config/constants.js';

// Seeds the two fixed accounts for this shop — one super admin and one admin —
// from environment variables. Idempotent: an account that already exists (by
// email) is left untouched.
//
//   npm run seed
//
const seedUser = async ({ name, email, password, role }) => {
  if (!email || !password) {
    console.warn(`⚠ Skipping ${role}: set its EMAIL and PASSWORD in .env`);
    return;
  }
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    console.log(`ℹ ${role} already exists: ${normalizedEmail} (no change)`);
    return;
  }
  await User.create({ name, email: normalizedEmail, password, role }); // hashed by pre-save hook
  console.log(`✔ ${role} created: ${normalizedEmail}`);
};

const seed = async () => {
  await connectDB();
  try {
    await seedUser({
      name: process.env.SUPERADMIN_NAME || 'Super Admin',
      email: process.env.SUPERADMIN_EMAIL,
      password: process.env.SUPERADMIN_PASSWORD,
      role: ROLE.SUPERADMIN,
    });
    await seedUser({
      name: process.env.ADMIN_NAME || 'Admin',
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      role: ROLE.ADMIN,
    });
  } catch (err) {
    console.error(`✖ Seed failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
