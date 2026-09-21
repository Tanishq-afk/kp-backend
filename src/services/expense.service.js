import Expense from '../models/Expense.js';
import { REPORT_TIMEZONE } from '../config/constants.js';
import { getPagination, buildPage } from '../utils/paginate.js';
import { istDayStart, istDayEnd, istDateKey } from './dashboard.service.js';

// Optional IST date range on createdAt.
const rangeMatch = (query = {}) => {
  const match = {};
  if (query.from || query.to) {
    match.createdAt = {};
    if (query.from) match.createdAt.$gte = istDayStart(query.from);
    if (query.to) match.createdAt.$lte = istDayEnd(query.to);
  }
  return match;
};

export const todayKey = () => istDateKey(new Date());

export const createExpense = async ({ reason, amount }, user) => {
  const expense = await Expense.create({ reason, amount, createdBy: user._id });
  return expense;
};

// Expenses in range (newest first) + the range total across ALL pages.
export const listExpenses = async (query) => {
  const match = rangeMatch(query);
  const pg = getPagination(query);
  const [items, total, totalAgg] = await Promise.all([
    Expense.find(match)
      .populate('createdBy', 'name role')
      .sort({ createdAt: -1 })
      .skip(pg.skip)
      .limit(pg.limit)
      .lean(),
    Expense.countDocuments(match),
    Expense.aggregate([{ $match: match }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
  ]);
  return { ...buildPage(items, total, pg), totalAmount: totalAgg[0]?.amount || 0 };
};

const bucketedTotals = (query, format) =>
  Expense.aggregate([
    { $match: rangeMatch(query) },
    {
      $group: {
        _id: { $dateToString: { format, date: '$createdAt', timezone: REPORT_TIMEZONE } },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: -1 } },
    { $project: { _id: 0, key: '$_id', total: 1, count: 1 } },
  ]);

// Day-wise totals: [{ key: 'YYYY-MM-DD', total, count }], newest first.
export const getDailyExpenses = (query) => bucketedTotals(query, '%Y-%m-%d');

// Month-wise totals: [{ key: 'YYYY-MM', total, count }], newest first.
export const getMonthlyExpenses = (query) => bucketedTotals(query, '%Y-%m');
