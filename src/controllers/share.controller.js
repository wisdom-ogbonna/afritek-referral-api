const shareService = require('../services/share.service');
const paymentService = require('../services/payment.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { HTTP_STATUS } = require('../utils/constants');

const getShareInfo = asyncHandler(async (req, res) => {
  const info = await shareService.getShareInfo();
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, info, 'Share info retrieved'));
});

const getMyShares = asyncHandler(async (req, res) => {
  const data = await shareService.getMyShares(req.user.uid);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Your shares retrieved'));
});

const buyShares = asyncHandler(async (req, res) => {
  const { quantity, gateway } = req.body;

  const result = await paymentService.initiatePurchase(
    req.user.uid,
    req.user.email,
    req.user.fullName,
    quantity,
    gateway
  );

  res
    .status(HTTP_STATUS.CREATED)
    .json(new ApiResponse(HTTP_STATUS.CREATED, result, 'Payment initiated. Complete payment to receive shares.'));
});

const verifyPaystack = asyncHandler(async (req, res) => {
  const { reference } = req.body;
  const result = await paymentService.verifyPaystack(reference);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result, 'Payment verified and shares credited'));
});

module.exports = {
  getShareInfo,
  getMyShares,
  buyShares,
  verifyPaystack,
};
