// ----------------------------------------------------------------------------
// Centralized error handling. Routes/controllers (added in later phases) throw
// or forward errors here so responses share one consistent JSON shape:
//   { success: false, message, errors? }
// ----------------------------------------------------------------------------

// 404 handler for unmatched routes.
export const notFound = (req, res, next) => {
  res.status(404);
  next(new Error(`Route not found: ${req.method} ${req.originalUrl}`));
};

// Final error handler. Translates common Mongoose/Mongo errors into clean
// client responses and hides stack traces outside development.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  // Prefer an explicit ApiError statusCode, then any status already set on the
  // response, otherwise 500.
  let status =
    err.statusCode || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
  let message = err.message || 'Internal Server Error';
  // ApiError may carry an array of field-level messages.
  let errors = Array.isArray(err.errors) ? err.errors : undefined;

  // Mongoose validation error -> 400 with per-field messages.
  if (err.name === 'ValidationError') {
    status = 400;
    errors = Object.values(err.errors).map((e) => e.message);
    message = 'Validation failed';
  }

  // Invalid ObjectId -> 400.
  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Duplicate key -> 409.
  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {}).join(', ');
    message = `Duplicate value for: ${field}`;
  }

  res.status(status).json({
    success: false,
    message,
    ...(errors ? { errors } : {}),
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
};
