const { body } = require('express-validator');

const depositValidator = [
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ gt: 0 })
    .withMessage('Amount must be a positive number')
    .toFloat(),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Description must be at most 255 characters'),
];

module.exports = {
  depositValidator,
};
