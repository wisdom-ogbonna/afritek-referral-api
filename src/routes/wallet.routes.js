const express = require('express');
const walletController = require('../controllers/wallet.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const { adminCreditValidator } = require('../validators/wallet.validator');
const { ROLES } = require('../utils/constants');

const router = express.Router();

// Admin-only manual balance adjustment.
//
// This was previously an open POST /wallet/deposit that any authenticated user
// could call to credit their own balance for free — and it paid out 15%/5%
// referral commissions on that fabricated amount. Commissions now come only
// from gateway-verified share purchases.
router.post(
  '/credit',
  authenticate,
  authorize(ROLES.ADMIN),
  adminCreditValidator,
  validate,
  walletController.adminCredit
);

// Get my wallet balance, holdings + recent commissions
router.get('/', authenticate, walletController.getWallet);

module.exports = router;
