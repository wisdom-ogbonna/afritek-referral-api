const express = require('express');
const rateLimit = require('express-rate-limit');
const adminController = require('../controllers/admin.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const {
  paginationValidator,
  uidValidator,
  listUsersValidator,
  setUserStatusValidator,
  setUserRoleValidator,
  listPaymentsValidator,
  listWithdrawalsValidator,
  processWithdrawalValidator,
} = require('../validators/admin.validator');
const { ROLES } = require('../utils/constants');

const router = express.Router();

/**
 * Tighter than the global /api limiter.
 *
 * These endpoints read the whole user base and move money, so a stolen admin
 * token should not also come with 100 requests per 15 minutes of enumeration
 * budget. Keyed per IP like the global one.
 */
const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: parseInt(process.env.ADMIN_RATE_LIMIT_MAX, 10) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many admin requests. Please slow down.',
    errors: [],
  },
});

// Every route below is behind all three. Applied at the router level rather than
// per-route so a new endpoint cannot be added unguarded by accident.
router.use(adminLimiter);
router.use(authenticate);
router.use(authorize(ROLES.ADMIN));

// ==================== overview ====================
router.get('/overview', adminController.getOverview);

// ==================== users ====================
router.get('/users', listUsersValidator, validate, adminController.listUsers);
router.get('/users/:uid', uidValidator, validate, adminController.getUser);

router.patch(
  '/users/:uid/status',
  setUserStatusValidator,
  validate,
  adminController.setUserStatus
);

// Role changes are the one thing a plain admin cannot do: it is the only
// operation that can create another admin.
router.patch(
  '/users/:uid/role',
  authorize(ROLES.SUPER_ADMIN),
  setUserRoleValidator,
  validate,
  adminController.setUserRole
);

// ==================== money ====================
router.get('/payments', listPaymentsValidator, validate, adminController.listPayments);
router.get('/investments', paginationValidator, validate, adminController.listInvestments);

router.get(
  '/withdrawals',
  listWithdrawalsValidator,
  validate,
  adminController.listWithdrawals
);

router.patch(
  '/withdrawals/:id/process',
  processWithdrawalValidator,
  validate,
  adminController.processWithdrawal
);

// ==================== platform ====================
router.get('/settings', adminController.getSettings);
router.get('/audit', paginationValidator, validate, adminController.listActions);

module.exports = router;
