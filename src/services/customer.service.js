import Customer from '../models/Customer.js';
import Bill from '../models/Bill.js';
import ApiError from '../utils/ApiError.js';
import { getPagination, buildPage } from '../utils/paginate.js';

const cleanPhone = (phone) => String(phone).trim();

// Create a customer. Duplicate phone surfaces as 409 (unique index).
export const createCustomer = async ({ name, phone, remarks }, createdBy) => {
  return Customer.create({ name, phone: cleanPhone(phone), remarks, createdBy: createdBy?._id });
};

// List customers with optional search (name or phone) + isActive filter.
export const listCustomers = async (query) => {
  const filter = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.search) {
    const rx = { $regex: String(query.search).trim(), $options: 'i' };
    filter.$or = [{ name: rx }, { phone: rx }];
  }

  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Customer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Customer.countDocuments(filter),
  ]);
  return buildPage(items, total, { page, limit });
};

export const getCustomer = async (id) => {
  const customer = await Customer.findById(id);
  if (!customer) throw new ApiError(404, 'Customer not found.');
  return customer;
};

// Exact phone lookup for the billing counter — returns the customer or null
// (null => a new customer, the UI prompts for a name).
export const findByPhone = async (phone) => {
  return Customer.findOne({ phone: cleanPhone(phone) });
};

export const updateCustomer = async (id, updates) => {
  const allowed = ['name', 'phone', 'remarks', 'isActive'];
  const patch = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = key === 'phone' ? cleanPhone(updates[key]) : updates[key];
  }

  const customer = await Customer.findByIdAndUpdate(id, patch, {
    new: true,
    runValidators: true,
  });
  if (!customer) throw new ApiError(404, 'Customer not found.');
  return customer;
};

// Delete a customer only if no bills reference them, so sales history keeps a
// valid customer link; otherwise advise deactivation.
export const deleteCustomer = async (id) => {
  const customer = await Customer.findById(id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const inUse = await Bill.exists({ customer: id });
  if (inUse) {
    throw new ApiError(
      409,
      'Customer has bills and cannot be deleted. Deactivate them instead.'
    );
  }

  await customer.deleteOne();
  return { id };
};

// Find-or-create by phone — used by the billing/returns flow when an admin
// enters a customer's name + number. Atomic upsert avoids races under concurrent
// bills. A non-empty `remarks` OVERRIDES the customer's standing note (latest
// entry wins, so it shows in the customer list); a blank note leaves any existing
// remark untouched. `remarks` stays on exactly one update operator to avoid a
// Mongo conflicting-path error.
export const upsertByPhone = async ({ name, phone, remarks }, createdBy) => {
  const phoneVal = cleanPhone(phone);
  const note = typeof remarks === 'string' ? remarks.trim() : '';
  const set = { name };
  const setOnInsert = { phone: phoneVal, createdBy: createdBy?._id };
  if (note) set.remarks = note;
  else setOnInsert.remarks = '';
  return Customer.findOneAndUpdate(
    { phone: phoneVal },
    { $set: set, $setOnInsert: setOnInsert },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
};
