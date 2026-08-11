const morgan = require('morgan');

const logger = {
  info: (message) => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[INFO] ${new Date().toISOString()} - ${message}`);
    }
  },
  error: (message) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
    }
  },
  warn: (message) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`);
    }
  },
  debug: (message) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`);
    }
  },
};

const morganMiddleware = morgan(
  process.env.NODE_ENV === 'production' ? 'combined' : 'dev',
  {
    skip: (req) => req.url === '/health',
  }
);

module.exports = {
  logger,
  morganMiddleware,
};
