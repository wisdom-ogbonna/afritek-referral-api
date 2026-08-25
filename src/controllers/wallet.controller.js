const walletService = require('../services/wallet.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { HTTP_STATUS } = require('../utils/constants');

/**
 * Admin-only manual credit. Defaults to the caller when no uid is supplied so
 * an admin topping up their own test account still works.
 */
const adminCredit = asyncHandler(async (req, res) => {
  const { amount, description, uid } = req.body;

  const result = await walletService.adminCredit(
    uid || req.user.uid,
    amount,
    req.user.uid,
    description
  );

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, result, 'Balance credited successfully'));
});

const getWallet = asyncHandler(async (req, res) => {
  const wallet = await walletService.getWallet(req.user.uid);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, wallet, 'Wallet retrieved successfully'));
});

module.exports = {
  adminCredit,
  getWallet,
};
