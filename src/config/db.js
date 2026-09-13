import dns from 'dns';
import mongoose from 'mongoose';

// Some networks (mobile hotspots in particular) mangle SRV DNS lookups, which
// `mongodb+srv://` URIs depend on, even though normal A-record lookups work
// fine on the same network. Detect that specific failure so we can retry once
// against public DNS instead of failing the whole app over a flaky resolver.
const isSrvDnsError = (err) =>
  /querySrv/i.test(err.message) || ['EBADRESP', 'ESERVFAIL', 'ETIMEOUT'].includes(err.code);

// Connects to MongoDB using MONGODB_URI from the environment.
// Exits the process on initial connection failure so we fail fast.
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('✖ MONGODB_URI is not set. Add it to your .env file.');
    process.exit(1);
  }

  // strictQuery keeps queries predictable; Mongoose 8 defaults are fine.
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri);
    console.log('✔ MongoDB connected');
  } catch (err) {
    if (uri.startsWith('mongodb+srv://') && isSrvDnsError(err)) {
      console.warn(
        `⚠ SRV DNS lookup failed (${err.message}); retrying with public DNS fallback`
      );
      dns.setServers(['8.8.8.8', '1.1.1.1', ...dns.getServers()]);

      try {
        await mongoose.connect(uri);
        console.log('✔ MongoDB connected (via DNS fallback)');
      } catch (retryErr) {
        console.error(`✖ MongoDB connection error after DNS fallback: ${retryErr.message}`);
        process.exit(1);
      }
    } else {
      console.error(`✖ MongoDB connection error: ${err.message}`);
      process.exit(1);
    }
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
