import 'dotenv/config';
import app from './app.js';
import connectDB from './config/db.js';

const PORT = process.env.PORT || 5000;

// Connect to MongoDB first, then start accepting requests.
const start = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`✔ Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });

  // Fail loudly on unhandled rejections instead of leaving the app in a bad state.
  process.on('unhandledRejection', (err) => {
    console.error(`✖ Unhandled rejection: ${err.message}`);
    server.close(() => process.exit(1));
  });
};

start();
