const { auth, db } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');
const asyncHandler = require('../utils/asyncHandler');

const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Access token is required');
  }

  const idToken = authHeader.split('Bearer ')[1];

  if (!idToken) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Access token is required');
  }

  try {
    const decodedToken = await auth.verifyIdToken(idToken, true); // checkRevoked = true

    // Fetch user document from Firestore
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();

    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'User record not found');
    }

    const userData = userDoc.data();

    if (!userData.isActive) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, MESSAGES.ACCOUNT_DISABLED);
    }

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      role: userData.role,
      fullName: userData.fullName,
      isVerified: userData.isVerified,
      isActive: userData.isActive,
      referralCode: userData.referralCode,
      referredBy: userData.referredBy || null,
    };

    next();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error.code === 'auth/id-token-expired') {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Token has expired. Please login again');
    }

    if (error.code === 'auth/id-token-revoked') {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Token has been revoked. Please login again');
    }

    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, MESSAGES.TOKEN_INVALID);
  }
});

module.exports = authenticate;
