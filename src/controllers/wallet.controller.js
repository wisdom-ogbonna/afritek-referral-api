const walletService = require('../services/wallet.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');

const deposit = asyncHandler(async (req, res) => {
  const { amount, description } = req.body;

  const result = await walletService.deposit(req.user.uid, amount, description);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, result, MESSAGES.DEPOSIT_SUCCESS));
});

const getWallet = asyncHandler(async (req, res) => {
  const wallet = await walletService.getWallet(req.user.uid);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, wallet, 'Wallet retrieved successfully'));
});

module.exports = {
  deposit,
  getWallet,
};
