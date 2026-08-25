const authService = require('../services/auth.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');

const signup = asyncHandler(async (req, res) => {
  const { fullName, email, password, phone, role, referralCode } = req.body;

  const result = await authService.signup({
    fullName,
    email,
    password,
    phone,
    role,
    referralCode,
  });

  res
    .status(HTTP_STATUS.CREATED)
    .json(
      new ApiResponse(HTTP_STATUS.CREATED, result, 'User registered successfully')
    );
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await authService.login(email, password);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, result, 'Login successful'));
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.uid);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, null, MESSAGES.LOGOUT_SUCCESS));
});

const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const tokens = await authService.refreshToken(refreshToken);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, { tokens }, 'Token refreshed successfully'));
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  await authService.forgotPassword(email);

  res
    .status(HTTP_STATUS.OK)
    .json(
      new ApiResponse(
        HTTP_STATUS.OK,
        null,
        'If an account with that email exists, a password reset link has been sent'
      )
    );
});

const resetPassword = asyncHandler(async (req, res) => {
  const { oobCode, newPassword } = req.body;

  await authService.resetPassword(oobCode, newPassword);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, null, 'Password has been reset successfully'));
});

const sendEmailVerification = asyncHandler(async (req, res) => {
  await authService.sendEmailVerification(req.user.email);

  res
    .status(HTTP_STATUS.OK)
    .json(
      new ApiResponse(
        HTTP_STATUS.OK,
        null,
        'Verification email sent successfully'
      )
    );
});

const verifyEmail = asyncHandler(async (req, res) => {
  const { oobCode } = req.body;

  const result = await authService.verifyEmail(oobCode);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, result, 'Email verified successfully'));
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  await authService.changePassword(
    req.user.uid,
    req.user.email,
    currentPassword,
    newPassword
  );

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, null, MESSAGES.PASSWORD_CHANGED));
});

const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.uid);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, { user }, 'User profile retrieved'));
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.uid, req.body);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, { user }, MESSAGES.PROFILE_UPDATED));
});

const deleteAccount = asyncHandler(async (req, res) => {
  // Allow self-deletion or admin deleting another user via query/body
  const targetUid = req.params.uid || req.user.uid;

  await authService.deleteAccount(targetUid, req.user);

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, null, 'Account deleted successfully'));
});

module.exports = {
  signup,
  login,
  logout,
  refreshToken,
  forgotPassword,
  resetPassword,
  sendEmailVerification,
  verifyEmail,
  changePassword,
  getMe,
  updateProfile,
  deleteAccount,
};
