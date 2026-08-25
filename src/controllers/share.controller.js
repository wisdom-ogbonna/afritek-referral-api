const shareService = require('../services/share.service');
const paymentService = require('../services/payment.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { HTTP_STATUS, MESSAGES, PAYMENT_ACTIONS } = require('../utils/constants');
const { resolveAction } = require('../validators/share.validator');

const getShareInfo = asyncHandler(async (req, res) => {
  const info = await shareService.getShareInfo();
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, info, 'Share info retrieved'));
});

const getMyShares = asyncHandler(async (req, res) => {
  const data = await shareService.getMyShares(req.user.uid);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Your shares retrieved'));
});

/**
 * The single payment endpoint for Paystack, Stripe and PayPal.
 *
 * `initiate` creates a pending payment and returns what the client needs to pay;
 * `verify` confirms with the gateway, credits shares, distributes referral
 * commissions and updates the payment status.
 */
const buyShares = asyncHandler(async (req, res) => {
  const action = resolveAction(req.body);

  if (action === PAYMENT_ACTIONS.VERIFY) {
    const { reference, orderId } = req.body;

    const result = await paymentService.verifyPurchase(req.user.uid, reference, orderId);

    return res.status(HTTP_STATUS.OK).json(
      new ApiResponse(
        HTTP_STATUS.OK,
        { action: PAYMENT_ACTIONS.VERIFY, ...result },
        result.alreadyProcessed ? MESSAGES.PAYMENT_ALREADY_PROCESSED : MESSAGES.PAYMENT_VERIFIED
      )
    );
  }

  const { quantity, gateway } = req.body;

  const result = await paymentService.initiatePurchase(
    req.user.uid,
    req.user.email,
    req.user.fullName,
    quantity,
    gateway
  );

  return res.status(HTTP_STATUS.CREATED).json(
    new ApiResponse(
      HTTP_STATUS.CREATED,
      { action: PAYMENT_ACTIONS.INITIATE, ...result },
      MESSAGES.PAYMENT_INITIATED
    )
  );
});

module.exports = {
  getShareInfo,
  getMyShares,
  buyShares,
};
