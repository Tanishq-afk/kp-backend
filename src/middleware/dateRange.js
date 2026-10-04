import { query } from 'express-validator';
import { isIstDateString } from '../utils/istDate.js';

// Optional IST date range for list / print endpoints: YYYY-MM-DD, real calendar dates.
const istDate = (field) =>
  query(field)
    .optional()
    .custom((value) => {
      if (!isIstDateString(value)) throw new Error(`${field} must be a date (YYYY-MM-DD)`);
      return true;
    });

export const dateRangeValidators = [istDate('from'), istDate('to')];

// Required variant (used where a range must be given), with a clear error.
export const requiredIstDate = (field) => (value) => {
  if (!isIstDateString(value)) throw new Error(`${field} must be a date (YYYY-MM-DD)`);
  return true;
};
