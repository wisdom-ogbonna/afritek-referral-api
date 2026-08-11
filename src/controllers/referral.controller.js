const referralService = require('../services/referral.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { HTTP_STATUS } = require('../utils/constants');

const getMyReferralStats = asyncHandler(async (req, res) => {
  const stats = await referralService.getReferralStats(req.user.uid);

  // Build a ready-to-share referral link
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const referralLink = `${frontendUrl}/signup?ref=${stats.referralCode}`;

  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(
      HTTP_STATUS.OK,
      {
        ...stats,
        referralLink, // ← ready-to-share link
      },
      'Referral stats retrieved successfully'
    )
  );
});

/**
 * Public endpoint – resolve a referral code from a shared link
 * Used by frontend when someone opens: /signup?ref=JOHN4F2A
 */
const resolveReferralCode = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const referrer = await referralService.resolveReferralCode(code);

  // Return only safe public info
  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(
      HTTP_STATUS.OK,
      {
        valid: true,
        referralCode: referrer.referralCode,
        referrer: {
          fullName: referrer.fullName,
          // You can add profileImage later if needed
        },
      },
      'Referral code is valid'
    )
  );
});

module.exports = {
  getMyReferralStats,
  resolveReferralCode,
};
