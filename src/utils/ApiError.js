// Operational error carrying an HTTP status code (and optional field errors),
// thrown from services/controllers and translated to a response by the central
// error handler.
//
//   throw new ApiError(401, 'Invalid email or password');
//   throw new ApiError(400, 'Validation failed', ['email is required']);
//
export default class ApiError extends Error {
  constructor(statusCode, message, errors) {
    super(message);
    this.statusCode = statusCode;
    this.errors = Array.isArray(errors) ? errors : undefined;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
