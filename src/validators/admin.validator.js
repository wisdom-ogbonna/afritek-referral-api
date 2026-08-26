const { body, param, query } = require('express-validator');
const { ROLES, PAYMENT_STATUS, WITHDRAWAL_STATUS, PAYMENT_GATEWAYS } = require('../utils/constants');

/** Shared by every list endpoint. The service clamps `limit` too — this only
 *  rejects nonsense before it gets there. */
const paginationValidator = [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('startAfter').optional().isInt({ min: 1 }).toInt(),
];

const uidValidator = [
  param('uid').trim().notEmpty().withMessage('User id is required').isLength({ max: 128 }),
];

const listUsersValidator = [
  ...paginationValidator,
  query('search').optional().trim().isLength({ max: 320 }),
  query('role').optional().isIn(Object.values(ROLES)).withMessage('Unknown role'),
  query('status').optional().isIn(['active', 'disabled']).withMessage('Unknown status'),
];

const setUserStatusValidator = [
  ...uidValidator,
  body('isActive')
    .exists()
    .withMessage('isActive is required')
    .isBoolean()
    .withMessage('isActive must be a boolean')
    .toBoolean(),
];

const setUserRoleValidator = [
  ...uidValidator,
  body('role')
    .trim()
    .notEmpty()
    .withMessage('role is required')
    .isIn(Object.values(ROLES))
    .withMessage('Unknown role'),
];

const listPaymentsValidator = [
  ...paginationValidator,
  query('status').optional().isIn(Object.values(PAYMENT_STATUS)),
  query('gateway').optional().isIn(Object.values(PAYMENT_GATEWAYS)),
];

const listWithdrawalsValidator = [
  ...paginationValidator,
  query('status').optional().isIn(Object.values(WITHDRAWAL_STATUS)),
];

/** Mirrors the existing processWithdrawalValidator so the admin route and the
 *  original /withdrawals route accept exactly the same body. */
const processWithdrawalValidator = [
  param('id').trim().notEmpty().withMessage('Withdrawal id is required'),
  body('action')
    .trim()
    .notEmpty()
    .withMessage('action is required')
    .isIn(['approve', 'reject'])
    .withMessage('Action must be approve or reject'),
  body('note').optional().trim().isLength({ max: 500 }),
];

module.exports = {
  paginationValidator,
  uidValidator,
  listUsersValidator,
  setUserStatusValidator,
  setUserRoleValidator,
  listPaymentsValidator,
  listWithdrawalsValidator,
  processWithdrawalValidator,
};
