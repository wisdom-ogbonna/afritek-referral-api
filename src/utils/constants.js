module.exports = {
  ROLES: {
    ADMIN: 'admin',
    MODERATOR: 'moderator',
    USER: 'user',
  },

  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER: 500,
  },

  MESSAGES: {
    SUCCESS: 'Success',
    CREATED: 'Resource created successfully',
    UPDATED: 'Resource updated successfully',
    DELETED: 'Resource deleted successfully',
    NOT_FOUND: 'Resource not found',
    UNAUTHORIZED: 'Unauthorized access',
    FORBIDDEN: 'You do not have permission to perform this action',
    VALIDATION_ERROR: 'Validation failed',
    INTERNAL_ERROR: 'Internal server error',
    USER_EXISTS: 'User with this email already exists',
    INVALID_CREDENTIALS: 'Invalid email or password',
    EMAIL_NOT_VERIFIED: 'Please verify your email address',
    ACCOUNT_DISABLED: 'Your account has been disabled',
    TOKEN_INVALID: 'Invalid or expired token',
    PASSWORD_CHANGED: 'Password changed successfully',
    PROFILE_UPDATED: 'Profile updated successfully',
    LOGOUT_SUCCESS: 'Logged out successfully',
    INVALID_REFERRAL_CODE: 'Invalid or expired referral code',
    SELF_REFERRAL: 'You cannot refer yourself',
    DEPOSIT_SUCCESS: 'Deposit successful and commissions distributed',
    INSUFFICIENT_SHARES: 'Not enough shares available',
    INSUFFICIENT_BALANCE: 'Insufficient wallet balance',
    PAYMENT_INITIATED: 'Payment initiated successfully',
    WITHDRAWAL_REQUESTED: 'Withdrawal request submitted successfully',
    INVALID_GATEWAY: 'Unsupported payment gateway',
  },

  REFERRAL_RATES: {
    LEVEL_1: parseFloat(process.env.REFERRAL_LEVEL1_RATE) || 15,
    LEVEL_2: parseFloat(process.env.REFERRAL_LEVEL2_RATE) || 5,
  },

  SHARES: {
    TOTAL: parseInt(process.env.TOTAL_SHARES, 10) || 1000000,
    PRICE: parseInt(process.env.SHARE_PRICE, 10) || 20000, // ₦20,000
    CURRENCY: process.env.CURRENCY || 'NGN',
  },

  PAYMENT_GATEWAYS: {
    PAYSTACK: 'paystack',
    STRIPE: 'stripe',
    PAYPAL: 'paypal',
  },

  PAYMENT_STATUS: {
    PENDING: 'pending',
    SUCCESS: 'success',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  },

  WITHDRAWAL_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    COMPLETED: 'completed',
  },
};
