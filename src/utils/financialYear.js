import { istDateKey } from './istDate.js';

// Indian financial year: Apr 1 - Mar 31. Given a date, returns the label the
// shop uses, e.g. "2026-27" for anything from 1 Apr 2026 through 31 Mar 2027.
export const getFinancialYear = (date = new Date()) => {
  const [y, m] = istDateKey(date).split('-').map(Number); // 'YYYY-MM-DD'
  const startYear = m >= 4 ? y : y - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
};

// The per-financial-year counter key, e.g. "bill_2026-27" — a fresh Counter
// document per FY is exactly how the sequence resets to 1 every 1 April.
export const billCounterKey = (fy) => `bill_${fy}`;

export default getFinancialYear;
