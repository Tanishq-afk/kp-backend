import { istRangeFilter } from '../utils/istDate.js';

// Escapes user text before it is used in a case-insensitive $regex search.
const containsRx = (text) => ({
  $regex: String(text).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  $options: 'i',
});

// Bill history filter, shared by the on-screen list and the print list so the
// printed listing always matches the screen. Held bills are excluded by default.
export const billListFilter = (query = {}) => {
  const filter = { status: query.status || { $ne: 'held' } };
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.financialYear) filter.financialYear = query.financialYear;
  const createdAt = istRangeFilter(query);
  if (createdAt) filter.createdAt = createdAt;
  if (query.search) {
    const rx = containsRx(query.search);
    filter.$or = [{ billNumber: rx }, { customerName: rx }, { customerPhone: rx }];
  }
  return filter;
};

// Returns history filter, shared by the on-screen history and the print list.
export const returnListFilter = (query = {}) => {
  const filter = {};
  const createdAt = istRangeFilter(query);
  if (createdAt) filter.createdAt = createdAt;
  if (query.search) {
    const rx = containsRx(query.search);
    filter.$or = [{ returnNumber: rx }, { originalBillNumber: rx }, { customerName: rx }, { customerPhone: rx }];
  }
  return filter;
};
