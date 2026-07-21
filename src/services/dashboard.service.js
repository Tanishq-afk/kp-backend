import Bill from '../models/Bill.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import User from '../models/User.js';
import { REPORT_TIMEZONE, ROLE } from '../config/constants.js';

// ---- IST day helpers -------------------------------------------------------
const IST_OFFSET_MIN = 330; // Asia/Kolkata is UTC+5:30 (no DST)

// UTC instant of IST-midnight for the given date (default: now).
const istDayStart = (d = new Date()) => {
  const shifted = new Date(new Date(d).getTime() + IST_OFFSET_MIN * 60000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MIN * 60000);
};
const istDayEnd = (d) => new Date(istDayStart(d).getTime() + 24 * 3600 * 1000 - 1);

// 'YYYY-MM-DD' in IST (matches $dateToString with the same timezone).
const istDateKey = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIMEZONE }).format(d);

// Match clause: completed bills, optionally within an IST date range.
const salesMatch = (query = {}) => {
  const match = { status: 'completed' };
  if (query.from || query.to) {
    match.createdAt = {};
    if (query.from) match.createdAt.$gte = istDayStart(query.from);
    if (query.to) match.createdAt.$lte = istDayEnd(query.to);
  }
  return match;
};

const ZERO_TOTALS = { revenue: 0, bills: 0, itemsSold: 0, discountGiven: 0, taxCollected: 0 };

// KPI cards: totals over the range, a "today" snapshot, and live counts.
export const getSummary = async (query) => {
  const match = salesMatch(query);

  const [totalsAgg, todayAgg, products, customers, activeAdmins, heldBills] = await Promise.all([
    Bill.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$total' },
          bills: { $sum: 1 },
          itemsSold: { $sum: { $size: '$items' } },
          discountGiven: { $sum: '$discount' },
          taxCollected: { $sum: '$tax' },
        },
      },
    ]),
    Bill.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: istDayStart() } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, bills: { $sum: 1 } } },
    ]),
    Product.countDocuments({ isActive: true }),
    Customer.countDocuments({}),
    User.countDocuments({ role: ROLE.ADMIN, isActive: true }),
    Bill.countDocuments({ status: 'held' }),
  ]);

  const totals = { ...ZERO_TOTALS, ...(totalsAgg[0] || {}) };
  delete totals._id;
  const today = { revenue: todayAgg[0]?.revenue || 0, bills: todayAgg[0]?.bills || 0 };

  return {
    range: { from: query.from || null, to: query.to || null },
    totals,
    today,
    counts: { activeProducts: products, customers, activeAdmins, heldBills },
  };
};

// Day-wise sales for charts. When both from & to are given, missing days are
// filled with zeros so the series is continuous.
export const getDailySales = async (query) => {
  const match = salesMatch(query);
  const rows = await Bill.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: REPORT_TIMEZONE } },
        revenue: { $sum: '$total' },
        bills: { $sum: 1 },
        itemsSold: { $sum: { $size: '$items' } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', revenue: 1, bills: 1, itemsSold: 1 } },
  ]);

  if (!query.from || !query.to) return rows;

  // gap-fill the inclusive range
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const filled = [];
  const end = istDayStart(query.to).getTime();
  for (let cur = istDayStart(query.from).getTime(); cur <= end; cur += 24 * 3600 * 1000) {
    const key = istDateKey(new Date(cur));
    filled.push(byDate.get(key) || { date: key, revenue: 0, bills: 0, itemsSold: 0 });
  }
  return filled;
};

// Split of collected money by payment method (pie chart).
export const getPaymentMethodBreakdown = async (query) => {
  return Bill.aggregate([
    { $match: salesMatch(query) },
    { $unwind: '$payments' },
    { $group: { _id: '$payments.method', amount: { $sum: '$payments.amount' }, count: { $sum: 1 } } },
    { $project: { _id: 0, method: '$_id', amount: 1, count: 1 } },
    { $sort: { amount: -1 } },
  ]);
};

// Best sellers by gross revenue (sum of item MRP) and units sold.
export const getTopProducts = async (query, limit = 10) => {
  return Bill.aggregate([
    { $match: salesMatch(query) },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        productName: { $first: '$items.productName' },
        articleNumber: { $first: '$items.articleNumber' },
        qty: { $sum: 1 },
        revenue: { $sum: '$items.mrp' },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
    { $project: { _id: 0, product: '$_id', productName: 1, articleNumber: 1, qty: 1, revenue: 1 } },
  ]);
};

// Gross sales grouped by category (pie chart). Resolves category via the
// product (products with sales can't be deleted, so the lookup always hits).
export const getSalesByCategory = async (query) => {
  return Bill.aggregate([
    { $match: salesMatch(query) },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', qty: { $sum: 1 }, revenue: { $sum: '$items.mrp' } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
    { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
    { $group: { _id: '$p.category', revenue: { $sum: '$revenue' }, qty: { $sum: '$qty' } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
    {
      $project: {
        _id: 0,
        category: '$_id',
        categoryName: { $arrayElemAt: ['$c.name', 0] },
        revenue: 1,
        qty: 1,
      },
    },
    { $sort: { revenue: -1 } },
  ]);
};
