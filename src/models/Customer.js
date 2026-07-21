import mongoose from 'mongoose';

// Walk-in / repeat customers. Linked from a Bill so each sale can be traced
// back to who it was for.
const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
    },
    // Phone is the customer's identity at the billing counter (used to find or
    // create a customer), so it is unique.
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      unique: true,
    },
    remarks: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

const Customer = mongoose.model('Customer', customerSchema);

export default Customer;
