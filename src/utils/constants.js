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
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
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
    PAYMENT_INITIATED: 'Payment initiated. Complete payment to receive shares.',
    PAYMENT_VERIFIED: 'Payment verified successfully and shares credited',
    PAYMENT_ALREADY_PROCESSED: 'Payment has already been processed',
    PAYMENT_NOT_COMPLETED: 'Payment has not been completed yet',
    PAYMENT_NOT_FOUND: 'Payment not found',
    PAYMENT_FORBIDDEN: 'This payment does not belong to you',
    WITHDRAWAL_REQUESTED: 'Withdrawal request submitted successfully',
    INVALID_GATEWAY: 'Unsupported payment gateway',
    INVALID_ACTION: "action must be either 'initiate' or 'verify'",
    ACTION_CONFLICT: "reference must not be sent when action is 'initiate'",
    FX_UNAVAILABLE:
      'Naira pricing is temporarily unavailable. Please try again shortly or pay by card.',
    AMOUNT_MISMATCH: 'Amount paid does not match the order total. Please contact support.',
  },

  REFERRAL_RATES: {
    LEVEL_1: parseFloat(process.env.REFERRAL_LEVEL1_RATE) || 15,
    LEVEL_2: parseFloat(process.env.REFERRAL_LEVEL2_RATE) || 5,
  },

  SHARES: {
    TOTAL: parseInt(process.env.TOTAL_SHARES, 10) || 1000000,

    // USD is the pricing currency. Stripe and PayPal bill this figure directly;
    // Paystack bills the NGN equivalent at the rate fxService resolves, pinned
    // onto the payment at initiation. Never read a price from the client.
    PRICE_USD: parseFloat(process.env.SHARE_PRICE_USD) || 20,
    CURRENCY: process.env.CURRENCY || 'USD',

    // A single order of the full 1,000,000-share supply would be $20,000,000,
    // which exceeds the per-charge maximum at every gateway and only ever
    // surfaces as an opaque 502. Bound it here instead.
    MAX_PER_ORDER: parseInt(process.env.MAX_SHARES_PER_ORDER, 10) || 10000,
  },

  WITHDRAWAL: {
    // Wallet balances are referral commissions, which are a percentage of a USD
    // purchase total — so they are USD, and so is this floor.
    //
    // Deliberately a NEW env name rather than reusing MIN_WITHDRAWAL: that was
    // ₦1,000, and reading the same value against a USD balance would silently
    // become a $1,000 minimum that no referrer could ever reach.
    MIN_USD: parseFloat(process.env.MIN_WITHDRAWAL_USD) || 10,
    FEE_PERCENT: parseFloat(process.env.WITHDRAWAL_FEE_PERCENT) || 0,
    CURRENCY: 'USD',
  },

  PAYMENT_GATEWAYS: {
    PAYSTACK: 'paystack',
    STRIPE: 'stripe',
    PAYPAL: 'paypal',
  },

  // The two modes of POST /shares/buy. Resolved from body.action when sent,
  // otherwise inferred from whether a reference is present.
  PAYMENT_ACTIONS: {
    INITIATE: 'initiate',
    VERIFY: 'verify',
  },

  PAYMENT_STATUS: {
    PENDING: 'pending',
    COMPLETED: 'completed',
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
