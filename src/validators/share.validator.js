const { body } = require('express-validator');
const { PAYMENT_GATEWAYS, PAYMENT_ACTIONS, MESSAGES } = require('../utils/constants');

const REFERENCE_PATTERN = /^SHR_[A-Z0-9]{16}$/;

/**
 * Resolve which mode of POST /shares/buy a request body is asking for.
 *
 * An explicit `action` always wins; otherwise the presence of `reference`
 * decides, so existing `{quantity, gateway}` initiate calls keep working.
 * Shared by the validator and the controller so the two cannot disagree.
 */
const resolveAction = (body = {}) => {
  if (body.action !== undefined && body.action !== null && body.action !== '') {
    return String(body.action).trim().toLowerCase();
  }

  return body.reference ? PAYMENT_ACTIONS.VERIFY : PAYMENT_ACTIONS.INITIATE;
};

const isInitiate = (value, { req }) => resolveAction(req.body) === PAYMENT_ACTIONS.INITIATE;
const isVerify = (value, { req }) => resolveAction(req.body) === PAYMENT_ACTIONS.VERIFY;

/**
 * True when the body explicitly says `initiate` but also carries a `reference`.
 * Used to suppress the per-mode field errors so the 422 reports only the
 * contradiction, which is the thing the caller actually needs to fix.
 */
const hasActionConflict = (body = {}) => {
  const { action, reference } = body;

  const explicitInitiate =
    action !== undefined &&
    action !== null &&
    action !== '' &&
    String(action).trim().toLowerCase() === PAYMENT_ACTIONS.INITIATE;

  return explicitInitiate && reference !== undefined && reference !== null && reference !== '';
};

const buySharesValidator = [
  body('action')
    .optional({ values: 'falsy' })
    .customSanitizer((value) => String(value).trim().toLowerCase())
    .isIn(Object.values(PAYMENT_ACTIONS))
    .withMessage(MESSAGES.INVALID_ACTION),

  // Sending a reference alongside an explicit initiate is contradictory —
  // reject it rather than silently picking one meaning.
  body('reference').custom((value, { req }) => {
    if (hasActionConflict(req.body)) {
      throw new Error(MESSAGES.ACTION_CONFLICT);
    }

    return true;
  }),

  // ---- initiate mode ----
  body('quantity')
    .if((value, { req }) => isInitiate(value, { req }) && !hasActionConflict(req.body))
    .notEmpty()
    .withMessage('Quantity is required')
    .bail()
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer')
    .toInt(),
  body('gateway')
    .if((value, { req }) => isInitiate(value, { req }) && !hasActionConflict(req.body))
    .notEmpty()
    .withMessage('Payment gateway is required')
    .bail()
    .isIn(Object.values(PAYMENT_GATEWAYS))
    .withMessage(`Gateway must be one of: ${Object.values(PAYMENT_GATEWAYS).join(', ')}`),

  // ---- verify mode ----
  body('reference')
    .if(isVerify)
    .notEmpty()
    .withMessage('Reference is required to verify a payment')
    .bail()
    .isString()
    .withMessage('Reference must be a string')
    .bail()
    .trim()
    .matches(REFERENCE_PATTERN)
    .withMessage('Reference must look like SHR_XXXXXXXXXXXXXXXX'),

  // PayPal only, and optional — initiatePurchase persists the order id, so the
  // client normally never needs to send it back.
  body('orderId')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('orderId must be a string')
    .bail()
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage('orderId must be between 1 and 128 characters'),
];

module.exports = {
  buySharesValidator,
  resolveAction,
  REFERENCE_PATTERN,
};
