const { body } = require('express-validator');
const { PAYMENT_GATEWAYS } = require('../utils/constants');

const buySharesValidator = [
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer')
    .toInt(),
  body('gateway')
    .notEmpty()
    .withMessage('Payment gateway is required')
    .isIn(Object.values(PAYMENT_GATEWAYS))
    .withMessage(`Gateway must be one of: ${Object.values(PAYMENT_GATEWAYS).join(', ')}`),
];

module.exports = {
  buySharesValidator,
};
