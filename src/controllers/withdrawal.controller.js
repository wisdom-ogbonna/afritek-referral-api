const withdrawalService = require('../services/withdrawal.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');

const requestWithdrawal = asyncHandler(async (req, res) => {
  const { amount, accountName, accountNumber, bankCode, bankName } = req.body;

  const result = await withdrawalService.requestWithdrawal(req.user.uid, amount, {
    accountName,
    accountNumber,
    bankCode,
    bankName,
  });

  res
    .status(HTTP_STATUS.CREATED)
    .json(new ApiResponse(HTTP_STATUS.CREATED, result, MESSAGES.WITHDRAWAL_REQUESTED));
});

const getMyWithdrawals = asyncHandler(async (req, res) => {
  const list = await withdrawalService.getMyWithdrawals(req.user.uid);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { withdrawals: list }, 'Withdrawals retrieved'));
});

const listPending = asyncHandler(async (req, res) => {
  const list = await withdrawalService.listPending();
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { withdrawals: list }, 'Pending withdrawals'));
});

const processWithdrawal = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, note } = req.body;

  const result = await withdrawalService.processWithdrawal(id, action, req.user.uid, note);

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result, `Withdrawal ${action}d successfully`));
});

module.exports = {
  requestWithdrawal,
  getMyWithdrawals,
  listPending,
  processWithdrawal,
};
