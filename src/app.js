const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { morganMiddleware } = require('./utils/logger');
const errorHandler = require('./middlewares/errorHandler');
const notFound = require('./middlewares/notFound');
const authRoutes = require('./routes/auth.routes');
const referralRoutes = require('./routes/referral.routes');
const walletRoutes = require('./routes/wallet.routes');
const shareRoutes = require('./routes/share.routes');
const withdrawalRoutes = require('./routes/withdrawal.routes');
const paymentWebhooks = require('./webhooks/payment.webhook');

const app = express();

// Security headers
app.use(helmet());

// CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// Compression
app.use(compression());

// IMPORTANT: Webhooks need raw body for Stripe signature – mount before json parser
app.use('/api/v1/webhooks', paymentWebhooks);

// Body parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Logging
app.use(morganMiddleware);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later',
    errors: [],
  },
});
app.use('/api', limiter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
  });
});

// API routes
const apiPrefix = process.env.API_PREFIX || '/api/v1';
app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/referrals`, referralRoutes);
app.use(`${apiPrefix}/wallet`, walletRoutes);
app.use(`${apiPrefix}/shares`, shareRoutes);
app.use(`${apiPrefix}/withdrawals`, withdrawalRoutes);

// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

module.exports = app;
