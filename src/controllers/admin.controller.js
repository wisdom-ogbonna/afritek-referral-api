const adminService = require('../services/admin.service');
const withdrawalService = require('../services/withdrawal.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');

const getOverview = asyncHandler(async (req, res) => {
  const data = await adminService.getOverview();
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, MESSAGES.SUCCESS));
});

const listUsers = asyncHandler(async (req, res) => {
  const { search, role, status, limit, startAfter } = req.query;
  const data = await adminService.listUsers({ search, role, status, limit, startAfter });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, MESSAGES.SUCCESS));
});

const getUser = asyncHandler(async (req, res) => {
  const data = await adminService.getUser(req.params.uid);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, MESSAGES.SUCCESS));
});

const setUserStatus = asyncHandler(async (req, res) => {
  const data = await adminService.setUserActive(req.params.uid, req.body.isActive, req.user);
  res
    .status(HTTP_STATUS.OK)
    .json(
      new ApiResponse(
        HTTP_STATUS.OK,
        data,
        data.isActive ? 'Account enabled' : 'Account disabled'
      )
    );
});

const setUserRole = asyncHandler(async (req, res) => {
  const data = await adminService.setUserRole(req.params.uid, req.body.role, req.user);
  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, data, `Role updated to ${data.role}`));
});

const listPayments = asyncHandler(async (req, res) => {
  const { status, gateway, limit, startAfter } = req.query;
  const data = await adminService.listPayments({ status, gateway, limit, startAfter });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, MESSAGES.SUCCESS));
});

const listInvestments = asyncHandler(async (req, res) => {
  const { limit, startAfter } = req.query;
  const data = await adminService.listPurchases({ limit, startAfter });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, MESSAGES.SUCCESS));
});

const listWithdrawals = asyncHandler(async (req, res) => {
  const { status, limit, startAfter } = req.query;
  const data = await adminService.listWithdrawals({ status, limit, startAfter });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, MESSAGES.SUCCESS));
});

/**
 * Approve or reject a withdrawal.
 *
 * The ledger work is withdrawalService.processWithdrawal()'s — it owns the
 * transaction that releases or keeps the hold taken at request time. This only
 * passes the acting admin through and records the audit entry, so there is
 * exactly one implementation of the money movement whether it is triggered from
 * here or from the existing PATCH /withdrawals/:id/process.
 */
const processWithdrawal = asyncHandler(async (req, res) => {
  const { action, note = '' } = req.body;

  const result = await withdrawalService.processWithdrawal(
    req.params.id,
    action,
    req.user.uid,
    note
  );

  await adminService.logAction(req.user.uid, `withdrawal.${action}`, result.uid, {
    withdrawalId: req.params.id,
    amount: result.amount,
    currency: result.currency,
    note,
  });

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, result, `Withdrawal ${result.status}`));
});

const getSettings = asyncHandler(async (req, res) => {
  const data = await adminService.getSettings();
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, MESSAGES.SUCCESS));
});

const listActions = asyncHandler(async (req, res) => {
  const { limit, startAfter } = req.query;
  const data = await adminService.listActions({ limit, startAfter });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, MESSAGES.SUCCESS));
});

module.exports = {
  getOverview,
  listUsers,
  getUser,
  setUserStatus,
  setUserRole,
  listPayments,
  listInvestments,
  listWithdrawals,
  processWithdrawal,
  getSettings,
  listActions,
};
