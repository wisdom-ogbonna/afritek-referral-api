const express = require('express');
const authController = require('../controllers/auth.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const {
  signupValidator,
  loginValidator,
  refreshTokenValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
  updateProfileValidator,
  verifyEmailValidator,
} = require('../validators/auth.validator');
const { ROLES } = require('../utils/constants');

const router = express.Router();

// Public routes
router.post('/signup', signupValidator, validate, authController.signup);
router.post('/login', loginValidator, validate, authController.login);
router.post('/refresh-token', refreshTokenValidator, validate, authController.refreshToken);
router.post('/forgot-password', forgotPasswordValidator, validate, authController.forgotPassword);
router.post('/reset-password', resetPasswordValidator, validate, authController.resetPassword);
router.post('/verify-email', verifyEmailValidator, validate, authController.verifyEmail);

// Protected routes
router.post('/logout', authenticate, authController.logout);
router.post(
  '/send-email-verification',
  authenticate,
  authController.sendEmailVerification
);
router.patch(
  '/change-password',
  authenticate,
  changePasswordValidator,
  validate,
  authController.changePassword
);
router.get('/me', authenticate, authController.getMe);
router.patch(
  '/profile',
  authenticate,
  updateProfileValidator,
  validate,
  authController.updateProfile
);

// Delete own account
router.delete('/account', authenticate, authController.deleteAccount);

// Admin can delete any user
router.delete(
  '/account/:uid',
  authenticate,
  authorize(ROLES.ADMIN),
  authController.deleteAccount
);

module.exports = router;
