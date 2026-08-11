const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');
const { logger } = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let error = err;

  console.error('========================================');
  console.error('ORIGINAL ERROR');
  console.error('Message:', err.message);
  console.error('Code:', err.code);
  console.error('Code type:', typeof err.code);
  console.error('Status:', err.statusCode);
  console.error('Name:', err.name);
  console.error('Stack:', err.stack);
  console.error('========================================');

  // Convert unknown errors into ApiError
  if (!(error instanceof ApiError)) {
    const statusCode =
      error.statusCode ||
      error.status ||
      HTTP_STATUS.INTERNAL_SERVER;

    const message =
      error.message ||
      MESSAGES.INTERNAL_ERROR;

    error = new ApiError(
      statusCode,
      message,
      error.errors || []
    );
  }

  // Firebase specific error mapping
  if (
    typeof err.code === 'string' &&
    err.code.startsWith('auth/')
  ) {
    switch (err.code) {
      case 'auth/email-already-exists':
        error = new ApiError(
          HTTP_STATUS.CONFLICT,
          'Email already exists'
        );
        break;

      case 'auth/invalid-email':
        error = new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'Invalid email address'
        );
        break;

      case 'auth/user-not-found':
        error = new ApiError(
          HTTP_STATUS.NOT_FOUND,
          'User not found'
        );
        break;

      case 'auth/wrong-password':
        error = new ApiError(
          HTTP_STATUS.UNAUTHORIZED,
          MESSAGES.INVALID_CREDENTIALS
        );
        break;

      case 'auth/id-token-expired':
        error = new ApiError(
          HTTP_STATUS.UNAUTHORIZED,
          'Token has expired'
        );
        break;

      case 'auth/id-token-revoked':
        error = new ApiError(
          HTTP_STATUS.UNAUTHORIZED,
          'Token has been revoked'
        );
        break;

      case 'auth/invalid-id-token':
        error = new ApiError(
          HTTP_STATUS.UNAUTHORIZED,
          'Invalid authentication token'
        );
        break;

      case 'auth/argument-error':
        error = new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'Invalid token'
        );
        break;

      case 'auth/insufficient-permission':
        error = new ApiError(
          HTTP_STATUS.FORBIDDEN,
          MESSAGES.FORBIDDEN
        );
        break;

      default:
        error = new ApiError(
          HTTP_STATUS.UNAUTHORIZED,
          err.message || 'Authentication error'
        );
        break;
    }
  }

  logger.error(
    `${error.statusCode} - ${error.message} - ${req.originalUrl} - ${req.method}`
  );

  const response = {
    success: false,
    message: error.message,
    errors: error.errors || [],
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = error.stack;
  }

  res
    .status(error.statusCode || HTTP_STATUS.INTERNAL_SERVER)
    .json(response);
};

module.exports = errorHandler;