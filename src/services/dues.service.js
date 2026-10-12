import mongoose from 'mongoose';
import Bill from '../models/Bill.js';
import Customer from '../models/Customer.js';
import DuePayment from '../models/DuePayment.js';
import ApiError from '../utils/ApiError.js';

// Money is kept to paise so repeated subtraction never drifts.
const money = (n) => Math.round(n * 100) / 100;

// Customers with an unpaid credit balance, largest first, with totals. The print
// list and the dues screen both read this.
export const listOutstanding = async () => {
  const rows = await Bill.aggregate([
    { $match: { status: 'completed', amountDue: { $gt: 0 }, customer: { $ne: null } } },
    {
      $group: {
        _id: '$customer',
        due: { $sum: '$amountDue' },
        bills: { $sum: 1 },
        oldestBillAt: { $min: '$createdAt' },
      },
    },
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'c' } },
    { $unwind: '$c' },
    {
      $project: {
        _id: 0,
        customer: '$_id',
        name: '$c.name',
        phone: '$c.phone',
        due: { $round: ['$due', 2] },
        bills: 1,
        oldestBillAt: 1,
      },
    },
    { $sort: { due: -1 } },
  ]);
  return {
    items: rows,
    count: rows.length,
    total: money(rows.reduce((s, r) => s + r.due, 0)),
  };
};

// One customer's open credit bills (oldest first) and their payment history.
export const getCustomerDues = async (customerId) => {
  const customer = await Customer.findById(customerId).select('name phone').lean();
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const [bills, payments] = await Promise.all([
    Bill.find({ customer: customerId, status: 'completed', amountDue: { $gt: 0 } })
      .select('billNumber createdAt total amountPaid amountDue')
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    DuePayment.find({ customer: customerId }).sort({ receivedAt: -1 }).lean(),
  ]);

  return {
    customer,
    totalDue: money(bills.reduce((s, b) => s + b.amountDue, 0)),
    bills,
    payments,
  };
};

// Records a payment from a customer and applies it to their open bills, oldest first.
// Runs in one transaction; overpaying is rejected rather than held as advance money.
export const recordDuePayment = async ({ customerId, amount, method, reference }, user) => {
  const paid = money(Number(amount));
  if (!(paid > 0)) throw new ApiError(400, 'Amount must be more than 0.');

  const session = await mongoose.startSession();
  let record;
  try {
    await session.withTransaction(async () => {
      const customer = await Customer.findById(customerId).session(session).lean();
      if (!customer) throw new ApiError(404, 'Customer not found.');

      const open = await Bill.find({ customer: customerId, status: 'completed', amountDue: { $gt: 0 } })
        .sort({ createdAt: 1, _id: 1 })
        .session(session);
      const totalDue = money(open.reduce((s, b) => s + b.amountDue, 0));
      if (paid > totalDue) throw new ApiError(400, `Amount is more than the outstanding ₹${totalDue}.`);

      let remaining = paid;
      const allocations = [];
      for (const bill of open) {
        if (remaining <= 0) break;
        const take = money(Math.min(bill.amountDue, remaining));
        bill.amountDue = money(bill.amountDue - take);
        bill.amountPaid = money(bill.amountPaid + take);
        bill.paymentStatus = bill.amountDue === 0 ? 'paid' : 'partial';
        await bill.save({ session });
        allocations.push({ bill: bill._id, billNumber: bill.billNumber, amount: take });
        remaining = money(remaining - take);
      }

      [record] = await DuePayment.create(
        [{ customer: customerId, amount: paid, method, reference, allocations, createdBy: user._id }],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
  return record;
};
