import mongoose from 'mongoose';

// Connects to MongoDB using MONGODB_URI from the environment.
// Exits the process on initial connection failure so we fail fast.
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('✖ MONGODB_URI is not set. Add it to your .env file.');
    process.exit(1);
  }

  try {
    // strictQuery keeps queries predictable; Mongoose 8 defaults are fine.
    mongoose.set('strictQuery', true);

    await mongoose.connect(uri);
    console.log('✔ MongoDB connected');
  } catch (err) {
    console.error(`✖ MongoDB connection error: ${err.message}`);
    process.exit(1);
  }

  // Log later runtime disconnects/errors without crashing.
  mongoose.connection.on('disconnected', () => {
    console.warn('⚠ MongoDB disconnected');
  });
  mongoose.connection.on('error', (err) => {
    console.error(`✖ MongoDB error: ${err.message}`);
  });
};

export default connectDB;
