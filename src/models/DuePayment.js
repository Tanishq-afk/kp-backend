import mongoose from 'mongoose';
import { PAYMENT_METHODS } from '../config/constants.js';

// Where a customer payment went: the bill it settled and how much of it.
const allocationSchema = new mongoose.Schema(
  {
    bill: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', required: true },
    billNumber: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// A payment received from a customer against their credit (pending) bills. It is
// applied to the oldest open bill first, and the allocations keep every bill's
// balance traceable.
const duePaymentSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    amount: { type: Number, required: true, min: [0.01, 'Amount must be more than 0'] },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true },
    allocations: { type: [allocationSchema], default: [] },
    receivedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

const DuePayment = mongoose.model('DuePayment', duePaymentSchema);

export default DuePayment;
