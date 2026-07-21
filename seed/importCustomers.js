import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Customer from '../src/models/Customer.js';
import User from '../src/models/User.js';

// ----------------------------------------------------------------------------
// One-time bulk import of the shop's existing customers ("customer list.xlsx").
//   AccountName -> name, BillingCellNo -> phone (digits only).
// Phone is the unique identity, so rows with no/short phone or no name are
// skipped, and phones are de-duplicated within the file and against the DB.
//
// Usage: node seed/importCustomers.js <customers.json>
// ----------------------------------------------------------------------------

const cleanPhone = (p) => String(p ?? '').replace(/\D/g, '');
const str = (v) => String(v ?? '').trim();

const main = async () => {
  const jsonPath = process.argv[2];
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    console.error('Usage: node seed/importCustomers.js <customers.json>');
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Loaded ${rows.length} rows from ${jsonPath}`);

  await connectDB();
  try {
    const admin = await User.findOne({ role: 'admin' });
    const createdBy = admin?._id;

    // keep valid rows, de-duplicated by phone within the file
    const seen = new Set();
    const valid = [];
    let badName = 0;
    let badPhone = 0;
    let fileDup = 0;
    for (const r of rows) {
      const name = str(r.AccountName);
      const phone = cleanPhone(r.BillingCellNo);
      if (!name || name === '0') { badName += 1; continue; }
      if (phone.length < 7 || phone.length > 15) { badPhone += 1; continue; }
      if (seen.has(phone)) { fileDup += 1; continue; }
      seen.add(phone);
      valid.push({ name, phone });
    }
    console.log(`Valid: ${valid.length}  (skipped ${badName} bad-name, ${badPhone} bad-phone, ${fileDup} file-dup)`);

    // skip phones already in the DB (idempotent)
    const existing = new Set(await Customer.distinct('phone', { phone: { $in: valid.map((v) => v.phone) } }));
    const toInsert = valid.filter((v) => !existing.has(v.phone)).map((v) => ({ ...v, createdBy }));
    console.log(`${existing.size} already in DB, ${toInsert.length} to insert`);

    if (toInsert.length) {
      await Customer.insertMany(toInsert, { ordered: false });
      console.log(`Inserted ${toInsert.length} customers`);
    } else {
      console.log('Nothing new to import.');
    }
  } catch (err) {
    console.error('Import error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

main();
