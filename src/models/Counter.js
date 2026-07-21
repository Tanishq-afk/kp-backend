import mongoose from 'mongoose';

// Atomic sequence store. One document per named counter (e.g. "bill",
// "barcode"). Mutated only via $inc through utils/sequence.js so values are
// safe under concurrency.
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // counter name
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

const Counter = mongoose.model('Counter', counterSchema);

export default Counter;
