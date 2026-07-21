// Wraps an async route handler so any rejected promise is forwarded to Express'
// error handling (our central errorHandler) instead of crashing the request.
//
//   router.get('/me', asyncHandler(async (req, res) => { ... }));
//
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
