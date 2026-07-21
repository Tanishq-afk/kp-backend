import Counter from '../models/Counter.js';

// Atomically increments and returns the next value for a named counter.
// Used for human-readable bill numbers and barcode serial numbers so two
// concurrent operations never receive the same value.
//
//   const n = await getNextSequence(COUNTER.BILL); // 1, 2, 3, ...
//
export const getNextSequence = async (name, { step = 1, session } = {}) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: step } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return counter.seq;
};

// Reserves a block of `count` sequential numbers in one atomic update and
// returns the starting value. Useful when generating many barcodes at once.
// Returns the FIRST number of the reserved block: [start, start+count-1].
export const reserveSequenceBlock = async (name, count, { session } = {}) => {
  if (count <= 0) return null;
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: count } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return counter.seq - count + 1;
};

export default getNextSequence;
