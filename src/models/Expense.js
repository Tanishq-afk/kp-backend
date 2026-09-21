import mongoose from 'mongoose';

// A shop expense (rent, tea, repairs…). Purely informational: it is reported
// alongside sales but never feeds into bills, revenue, or the cash drawer.
// The day it belongs to is its createdAt, bucketed in IST like everything else.
const expenseSchema = new mongoose.Schema(
  {
    reason: {
      type: String,
      required: [true, 'Reason is required'],
      trim: true,
      maxlength: 200,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0.01, 'Amount must be greater than 0'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

expenseSchema.index({ createdAt: -1 });

const Expense = mongoose.model('Expense', expenseSchema);

export default Expense;
