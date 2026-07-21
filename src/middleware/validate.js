import { validationResult } from 'express-validator';
import ApiError from '../utils/ApiError.js';

// Runs after a set of express-validator checks; collects any failures into a
// single 400 ApiError with field-level messages.
const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const messages = result.array().map((e) => e.msg);
    return next(new ApiError(400, 'Validation failed', messages));
  }
  return next();
};

export default validate;
