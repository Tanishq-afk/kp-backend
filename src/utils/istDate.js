import { REPORT_TIMEZONE } from '../config/constants.js';

// The shop operates in India, so every business date (a "day" for billing, returns,
// expenses and reports) is an IST calendar day. Asia/Kolkata is UTC+5:30 with no DST.
const IST_OFFSET_MIN = 330;
const DAY_MS = 24 * 3600 * 1000;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

// True for a real calendar date written as YYYY-MM-DD (rejects e.g. 2026-02-30).
export const isIstDateString = (value) => {
  if (typeof value !== 'string' || !DATE_RX.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

// UTC instant of IST midnight at the start of the IST day containing `d` (default: now).
export const istDayStart = (d = new Date()) => {
  const shifted = new Date(new Date(d).getTime() + IST_OFFSET_MIN * 60000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MIN * 60000);
};

// UTC instant of the last millisecond of the IST day containing `d`.
export const istDayEnd = (d) => new Date(istDayStart(d).getTime() + DAY_MS - 1);

// 'YYYY-MM-DD' of the IST calendar day for an instant.
export const istDateKey = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIMEZONE }).format(d);

// A createdAt range covering whole IST days from `from` to `to` (both inclusive,
// either optional). Returns undefined when neither is given.
export const istRangeFilter = ({ from, to } = {}) => {
  if (!from && !to) return undefined;
  const range = {};
  if (from) range.$gte = istDayStart(from);
  if (to) range.$lte = istDayEnd(to);
  return range;
};
