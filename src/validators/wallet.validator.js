const { body } = require('express-validator');

/**
 * Admin manual credit. `uid` is optional — omitted means "credit me", which is
 * the common case when an admin is topping up a test account.
 */
const adminCreditValidator = [
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .bail()
    .isFloat({ gt: 0 })
    .withMessage('Amount must be a positive number')
    .toFloat(),
  body('uid')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('uid must be a string')
    .bail()
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage('uid must be between 1 and 128 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Description must be at most 255 characters'),
];

module.exports = {
  adminCreditValidator,
};
