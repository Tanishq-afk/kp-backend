import Bill from '../models/Bill.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import User from '../models/User.js';
import Return from '../models/Return.js';
import { REPORT_TIMEZONE, ROLE, LOW_STOCK_THRESHOLD } from '../config/constants.js';

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

// Match clause: return records within the same optional IST date range.
const returnMatch = (query = {}) => {
  const match = {};
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

  const [totalsAgg, todayAgg, returnsAgg, todayReturnsAgg, products, customers, activeAdmins, heldBills] =
    await Promise.all([
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
      // Returns in range. `refundImpact` = refunds against bills that are STILL
      // 'completed' (i.e. still counted in revenue above); a fully-returned bill
      // flips to 'refunded' and already drops out of revenue, so its refund must
      // NOT be subtracted again. netRevenue = revenue - refundImpact stays consistent.
      Return.aggregate([
        { $match: returnMatch(query) },
        { $lookup: { from: 'bills', localField: 'originalBill', foreignField: '_id', as: 'ob' } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            refundTotal: { $sum: '$refundTotal' },
            refundImpact: {
              $sum: {
                $cond: [{ $eq: [{ $arrayElemAt: ['$ob.status', 0] }, 'completed'] }, '$refundTotal', 0],
              },
            },
          },
        },
      ]),
      Return.aggregate([
        { $match: { createdAt: { $gte: istDayStart() } } },
        { $group: { _id: null, refundTotal: { $sum: '$refundTotal' } } },
      ]),
      Product.countDocuments({ isActive: true }),
      Customer.countDocuments({}),
      User.countDocuments({ role: ROLE.ADMIN, isActive: true }),
      Bill.countDocuments({ status: 'held' }),
    ]);

  const totals = { ...ZERO_TOTALS, ...(totalsAgg[0] || {}) };
  delete totals._id;
  totals.returns = { count: returnsAgg[0]?.count || 0, refundTotal: returnsAgg[0]?.refundTotal || 0 };
  totals.netRevenue = totals.revenue - (returnsAgg[0]?.refundImpact || 0);

  const todayRefunds = todayReturnsAgg[0]?.refundTotal || 0;
  const todayRevenue = todayAgg[0]?.revenue || 0;
  const today = {
    revenue: todayRevenue,
    bills: todayAgg[0]?.bills || 0,
    refunds: todayRefunds,
    netRevenue: todayRevenue - todayRefunds,
  };

  return {
    range: { from: query.from || null, to: query.to || null },
    totals,
    today,
    counts: { activeProducts: products, customers, activeAdmins, heldBills },
  };
};

// Day-wise sales for charts. Each day carries gross `revenue`, `refunds` (returns
// booked that day against still-counted bills), and `netRevenue = revenue - refunds`.
// When both from & to are given, missing days are filled with zeros.
export const getDailySales = async (query) => {
  const [rows, refundRows] = await Promise.all([
    Bill.aggregate([
      { $match: salesMatch(query) },
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
    ]),
    Return.aggregate([
      { $match: returnMatch(query) },
      { $lookup: { from: 'bills', localField: 'originalBill', foreignField: '_id', as: 'ob' } },
      { $match: { 'ob.status': 'completed' } }, // only refunds adjusting still-counted revenue
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: REPORT_TIMEZONE } },
          refunds: { $sum: '$refundTotal' },
        },
      },
    ]),
  ]);

  const refundByDate = new Map(refundRows.map((r) => [r._id, r.refunds]));
  const decorate = (row) => {
    const refunds = refundByDate.get(row.date) || 0;
    return { ...row, refunds, netRevenue: row.revenue - refunds };
  };

  if (!query.from || !query.to) return rows.map(decorate);

  // gap-fill the inclusive range
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const filled = [];
  const end = istDayStart(query.to).getTime();
  for (let cur = istDayStart(query.from).getTime(); cur <= end; cur += 24 * 3600 * 1000) {
    const key = istDateKey(new Date(cur));
    filled.push(decorate(byDate.get(key) || { date: key, revenue: 0, bills: 0, itemsSold: 0 }));
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

// Inventory oversight KPIs (superadmin) — not sales, current stock on hand.
export const getStockSummary = async () => {
  const [agg] = await Product.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        totalUnitsInStock: { $sum: '$currentStock' },
        inventoryCostValue: { $sum: { $multiply: ['$currentStock', '$costPrice'] } },
        inventoryRetailValue: { $sum: { $multiply: ['$currentStock', '$mrp'] } },
        outOfStock: { $sum: { $cond: [{ $eq: ['$currentStock', 0] }, 1, 0] } },
        lowStock: {
          $sum: {
            $cond: [
              { $and: [{ $gt: ['$currentStock', 0] }, { $lte: ['$currentStock', LOW_STOCK_THRESHOLD] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return {
    totalProducts: agg?.totalProducts || 0,
    totalUnitsInStock: agg?.totalUnitsInStock || 0,
    inventoryCostValue: agg?.inventoryCostValue || 0,
    inventoryRetailValue: agg?.inventoryRetailValue || 0,
    outOfStock: agg?.outOfStock || 0,
    lowStock: agg?.lowStock || 0,
  };
};

// Current stock (units + value) grouped by category — for a breakdown
// chart/table, not a sales metric.
export const getStockByCategory = async () => {
  return Product.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: '$category',
        productCount: { $sum: 1 },
        totalStock: { $sum: '$currentStock' },
        inventoryValue: { $sum: { $multiply: ['$currentStock', '$costPrice'] } },
      },
    },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
    {
      $project: {
        _id: 0,
        category: '$_id',
        categoryName: { $arrayElemAt: ['$c.name', 0] },
        productCount: 1,
        totalStock: 1,
        inventoryValue: 1,
      },
    },
    { $sort: { totalStock: -1 } },
  ]);
};

// Comprehensive single-day (IST) report for a specific calendar date — not a
// rolling 24h window. Covers sales rung up, money collected by method, returns /
// refunds, the net, and the day's bill + return lists for a printable receipt.
// `date` is a YYYY-MM-DD string (defaults to today in IST). Available to both
// admin (counter reconciliation) and superadmin (oversight).
export const getDaySummary = async (query = {}) => {
  const date = query.date ? String(query.date) : istDateKey(new Date());
  const inDay = { $gte: istDayStart(date), $lte: istDayEnd(date) };

  // A "sale" for the day = a bill rung up that day, even if later refunded, so
  // gross sales reflect what was actually billed. Exchanges are real sales too.
  const saleFilter = { status: { $in: ['completed', 'refunded'] }, createdAt: inDay };

  const [salesAgg, paymentsAgg, returnsAgg, returnItemsAgg, refundsAgg, billsList, returnsList] =
    await Promise.all([
      Bill.aggregate([
        { $match: saleFilter },
        {
          $group: {
            _id: null,
            bills: { $sum: 1 },
            gross: { $sum: '$total' },
            discount: { $sum: '$discount' },
            tax: { $sum: '$tax' },
            itemsSold: { $sum: { $size: '$items' } },
          },
        },
      ]),
      Bill.aggregate([
        { $match: saleFilter },
        { $unwind: '$payments' },
        { $group: { _id: '$payments.method', amount: { $sum: '$payments.amount' }, count: { $sum: 1 } } },
        { $project: { _id: 0, method: '$_id', amount: 1, count: 1 } },
        { $sort: { amount: -1 } },
      ]),
      Return.aggregate([
        { $match: { createdAt: inDay } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            refundTotal: { $sum: '$refundTotal' },
            exchangeTotal: { $sum: '$exchangeTotal' },
            itemsReturned: { $sum: { $size: '$items' } },
            exchanges: { $sum: { $cond: [{ $ifNull: ['$exchangeBill', false] }, 1, 0] } },
          },
        },
      ]),
      Return.aggregate([
        { $match: { createdAt: inDay } },
        { $unwind: '$items' },
        { $group: { _id: '$items.resellable', count: { $sum: 1 } } },
      ]),
      Return.aggregate([
        { $match: { createdAt: inDay } },
        { $unwind: '$settlement.payments' },
        { $group: { _id: '$settlement.payments.method', amount: { $sum: '$settlement.payments.amount' } } },
        { $project: { _id: 0, method: '$_id', amount: 1 } },
        { $sort: { amount: -1 } },
      ]),
      Bill.find(saleFilter)
        .select('billNumber customerName total paymentStatus returnRef items createdAt')
        .sort({ createdAt: 1 })
        .lean(),
      Return.find({ createdAt: inDay })
        .select('returnNumber originalBillNumber customerName refundTotal exchangeTotal netAmount settlement.direction createdAt')
        .sort({ createdAt: 1 })
        .lean(),
    ]);

  const sales = { bills: 0, gross: 0, discount: 0, tax: 0, itemsSold: 0, ...(salesAgg[0] || {}) };
  delete sales._id;
  const totalCollected = paymentsAgg.reduce((s, p) => s + p.amount, 0);

  const returns = {
    count: 0, refundTotal: 0, exchangeTotal: 0, itemsReturned: 0, exchanges: 0,
    ...(returnsAgg[0] || {}),
  };
  delete returns._id;
  returns.restocked = returnItemsAgg.find((r) => r._id === true)?.count || 0;
  returns.damaged = returnItemsAgg.find((r) => r._id === false)?.count || 0;
  const totalRefunded = refundsAgg.reduce((s, r) => s + r.amount, 0);

  return {
    date,
    sales,
    paymentsIn: paymentsAgg,
    totalCollected,
    returns,
    refundsOut: refundsAgg,
    totalRefunded,
    net: {
      revenue: sales.gross - returns.refundTotal,
      inDrawer: totalCollected - totalRefunded,
    },
    bills: billsList.map((b) => ({
      billNumber: b.billNumber,
      customerName: b.customerName || null,
      items: b.items?.length || 0,
      total: b.total,
      paymentStatus: b.paymentStatus,
      isExchange: Boolean(b.returnRef),
      createdAt: b.createdAt,
    })),
    returnsList: returnsList.map((r) => ({
      returnNumber: r.returnNumber,
      originalBillNumber: r.originalBillNumber,
      customerName: r.customerName || null,
      refundTotal: r.refundTotal,
      exchangeTotal: r.exchangeTotal,
      netAmount: r.netAmount,
      direction: r.settlement?.direction,
      createdAt: r.createdAt,
    })),
  };
};
