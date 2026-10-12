import asyncHandler from '../utils/asyncHandler.js';
import * as duesService from '../services/dues.service.js';

// GET /api/dues/customers — customers with an outstanding credit balance.
export const outstanding = asyncHandler(async (req, res) => {
  const data = await duesService.listOutstanding();
  res.json({ success: true, data });
});

// GET /api/dues/customers/:customerId — open bills + payment history for one customer.
export const customerDues = asyncHandler(async (req, res) => {
  const data = await duesService.getCustomerDues(req.params.customerId);
  res.json({ success: true, data });
});

// POST /api/dues/payments — record a payment against a customer's open bills.
export const recordPayment = asyncHandler(async (req, res) => {
  const { customer, amount, method, reference } = req.body;
  const data = await duesService.recordDuePayment(
    { customerId: customer, amount, method, reference },
    req.user
  );
  res.status(201).json({ success: true, data });
});
