// Pagination helpers shared by list endpoints.

// Parses `page`/`limit` query params into safe values + a mongo skip.
//   page >= 1 (default 1), limit 1..100 (default 20)
export const getPagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

// Wraps a result set with pagination metadata for the response.
export const buildPage = (items, total, { page, limit }) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
  },
});
