const express = require('express');
const referralController = require('../controllers/referral.controller');
const authenticate = require('../middlewares/authenticate');

const router = express.Router();

// Public – resolve a referral code from a shared link
// Example: GET /api/v1/referrals/resolve/JOHN4F2A
router.get('/resolve/:code', referralController.resolveReferralCode);

// Protected – get my referral code, link, stats & earnings
router.get('/me', authenticate, referralController.getMyReferralStats);

module.exports = router;
