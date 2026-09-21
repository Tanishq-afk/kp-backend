import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';

import { notFound, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import categoryRoutes from './routes/category.routes.js';
import productRoutes from './routes/product.routes.js';
import barcodeRoutes from './routes/barcode.routes.js';
import customerRoutes from './routes/customer.routes.js';
import billingRoutes from './routes/billing.routes.js';
import returnRoutes from './routes/return.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import reportRoutes from './routes/report.routes.js';
import expenseRoutes from './routes/expense.routes.js';

// Builds and configures the Express app. Route modules are mounted under /api
// in later phases (auth, products, billing, etc.).
const app = express();

// Render (and most PaaS hosts) sit behind a reverse proxy — without this,
// every request appears to come from the proxy's internal IP, which breaks
// per-IP rate limiting (and req.ip/req.secure generally). `1` trusts exactly
// one hop, matching a standard single-proxy deployment.
app.set('trust proxy', 1);

// ---- Security & core middleware ----
app.use(helmet());

// CORS: restrict to configured origins, or allow all if none configured (dev).
const origins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: origins.length > 0 ? origins : true,
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Strips any request key starting with "$" or containing "." (e.g. a crafted
// { "email": { "$ne": null } } body) so user input can never be interpreted
// as a MongoDB query operator. Defense-in-depth on top of express-validator.
app.use(mongoSanitize());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Basic rate limiting on the API surface.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// ---- Health check ----
app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', uptime: process.uptime() });
});

// ---- API routes ----
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/barcodes', barcodeRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/bills', billingRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/expenses', expenseRoutes);
// (more route modules mounted here in later phases)

// ---- Error handling (must be last) ----
app.use(notFound);
app.use(errorHandler);

export default app;
