const { body } = require('express-validator');

const withdrawValidator = [
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ gt: 0 })
    .withMessage('Amount must be a positive number')
    .toFloat(),
  body('accountName')
    .trim()
    .notEmpty()
    .withMessage('Account name is required')
    .isLength({ min: 2, max: 100 }),
  body('accountNumber')
    .trim()
    .notEmpty()
    .withMessage('Account number is required')
    .isLength({ min: 10, max: 10 })
    .withMessage('Account number must be 10 digits')
    .isNumeric(),
  body('bankCode')
    .trim()
    .notEmpty()
    .withMessage('Bank code is required'),
  body('bankName')
    .optional()
    .trim(),
];

const processWithdrawalValidator = [
  body('action')
    .notEmpty()
    .isIn(['approve', 'reject'])
    .withMessage('Action must be approve or reject'),
  body('note').optional().trim().isLength({ max: 500 }),
];

module.exports = {
  withdrawValidator,
  processWithdrawalValidator,
};
