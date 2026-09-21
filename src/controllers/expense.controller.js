import asyncHandler from '../utils/asyncHandler.js';
import { ROLE } from '../config/constants.js';
import * as expenseService from '../services/expense.service.js';

// POST /api/expenses (admin + superadmin)
export const create = asyncHandler(async (req, res) => {
  const expense = await expenseService.createExpense(req.body, req.user);
  res.status(201).json({ success: true, data: expense });
});

// GET /api/expenses?from&to&page&limit — list + range total (superadmin).
// Admins are pinned to a single day (?date=YYYY-MM-DD, default today); any
// from/to they send is ignored.
export const list = asyncHandler(async (req, res) => {
  let query = req.query;
  if (req.user.role === ROLE.ADMIN) {
    const date = query.date || expenseService.todayKey();
    query = { ...query, from: date, to: date };
  }
  const { items, pagination, totalAmount } = await expenseService.listExpenses(query);
  res.json({ success: true, data: items, pagination, totalAmount });
});

// GET /api/expenses/daily?from&to — day-wise totals (superadmin).
export const daily = asyncHandler(async (req, res) => {
  const data = await expenseService.getDailyExpenses(req.query);
  res.json({ success: true, data });
});

// GET /api/expenses/monthly?from&to — month-wise totals (superadmin).
export const monthly = asyncHandler(async (req, res) => {
  const data = await expenseService.getMonthlyExpenses(req.query);
  res.json({ success: true, data });
});
