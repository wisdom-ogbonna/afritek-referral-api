const axios = require('axios');
const { auth, db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES, ROLES } = require('../utils/constants');
const { logger } = require('../utils/logger');
const referralService = require('./referral.service');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_AUTH_REST = 'https://identitytoolkit.googleapis.com/v1';

class AuthService {
  /**
   * Create a new user (Firebase Auth + Firestore) with optional referral
   */
  async signup({ fullName, email, password, phone, role = ROLES.USER, referralCode }) {
    // Prevent public creation of admin accounts
    if (role === ROLES.ADMIN) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Cannot create admin account via public signup');
    }

    let referrerUid = null;

    // Resolve referral code if provided
    if (referralCode) {
      const referrer = await referralService.resolveReferralCode(referralCode);
      referrerUid = referrer.uid;
    }

    let userRecord;

    try {
      userRecord = await auth.createUser({
        email,
        password,
        displayName: fullName,
        emailVerified: false,
        disabled: false,
      });
    } catch (error) {
      if (error.code === 'auth/email-already-exists') {
        throw new ApiError(HTTP_STATUS.CONFLICT, MESSAGES.USER_EXISTS);
      }
      throw error;
    }

    // Prevent self-referral (edge case if somehow same email, but codes are unique)
    if (referrerUid && referrerUid === userRecord.uid) {
      // Cleanup the just created auth user
      await auth.deleteUser(userRecord.uid);
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.SELF_REFERRAL);
    }

    const now = FieldValue.serverTimestamp();
    const generatedReferralCode = await referralService.generateUniqueReferralCode(fullName);

    const userData = {
      uid: userRecord.uid,
      fullName,
      email: email.toLowerCase(),
      phone: phone || null,
      role,
      profileImage: null,
      isVerified: false,
      isActive: true,
      referralCode: generatedReferralCode,
      referredBy: referrerUid,
      balance: 0,
      sharesOwned: 0,
      totalInvested: 0,
      totalReferralEarnings: 0,
      createdAt: now,
      updatedAt: now,
      lastLogin: null,
    };

    await db.collection('users').doc(userRecord.uid).set(userData);

    // Set custom claims for RBAC
    await auth.setCustomUserClaims(userRecord.uid, { role });

    // Generate ID token via REST (signInWithPassword)
    const tokens = await this._signInWithEmailPassword(email, password);

    logger.info(
      `User created: ${userRecord.uid}${referrerUid ? ` referred by ${referrerUid}` : ''}`
    );

    return {
      user: {
        uid: userRecord.uid,
        fullName,
        email,
        phone: phone || null,
        role,
        profileImage: null,
        isVerified: false,
        isActive: true,
        referralCode: generatedReferralCode,
        referredBy: referrerUid,
        balance: 0,
        sharesOwned: 0,
        totalInvested: 0,
      },
      tokens,
    };
  }

  /**
   * Login with email & password
   */
  async login(email, password) {
    const tokens = await this._signInWithEmailPassword(email, password);

    // Verify the token to get uid
    const decoded = await auth.verifyIdToken(tokens.idToken);

    const userDoc = await db.collection('users').doc(decoded.uid).get();

    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User profile not found');
    }

    const userData = userDoc.data();

    if (!userData.isActive) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, MESSAGES.ACCOUNT_DISABLED);
    }

    // Update lastLogin
    await db.collection('users').doc(decoded.uid).update({
      lastLogin: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      user: {
        uid: userData.uid,
        fullName: userData.fullName,
        email: userData.email,
        phone: userData.phone,
        role: userData.role,
        profileImage: userData.profileImage,
        isVerified: userData.isVerified,
        isActive: userData.isActive,
        referralCode: userData.referralCode,
        referredBy: userData.referredBy || null,
        balance: userData.balance || 0,
        sharesOwned: userData.sharesOwned || 0,
        totalInvested: userData.totalInvested || 0,
      },
      tokens,
    };
  }

  /**
   * Logout – revoke all refresh tokens
   */
  async logout(uid) {
    await auth.revokeRefreshTokens(uid);
    logger.info(`Tokens revoked for user: ${uid}`);
    return true;
  }

  /**
   * Refresh ID token using refresh token
   */
  async refreshToken(refreshToken) {
    try {
      const response = await axios.post(
        `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }
      );

      return {
        idToken: response.data.id_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } catch (error) {
      const message =
        error.response?.data?.error?.message || 'Failed to refresh token';
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, message);
    }
  }

  /**
   * Send password reset email
   */
  async forgotPassword(email) {
    try {
      await auth.getUserByEmail(email);

      const response = await axios.post(
        `${FIREBASE_AUTH_REST}/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
        {
          requestType: 'PASSWORD_RESET',
          email,
        }
      );

      return { email: response.data.email };
    } catch (error) {
      // Do not reveal if email exists
      if (error.code === 'auth/user-not-found') {
        return { email };
      }
      const message =
        error.response?.data?.error?.message || 'Failed to send reset email';
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, message);
    }
  }

  /**
   * Confirm password reset with oobCode
   */
  async resetPassword(oobCode, newPassword) {
    try {
      const response = await axios.post(
        `${FIREBASE_AUTH_REST}/accounts:resetPassword?key=${FIREBASE_API_KEY}`,
        {
          oobCode,
          newPassword,
        }
      );

      return {
        email: response.data.email,
        requestType: response.data.requestType,
      };
    } catch (error) {
      const message =
        error.response?.data?.error?.message || 'Failed to reset password';
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, message);
    }
  }

  /**
   * Send email verification link
   */
  async sendEmailVerification(idToken) {
    try {
      const response = await axios.post(
        `${FIREBASE_AUTH_REST}/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
        {
          requestType: 'VERIFY_EMAIL',
          idToken,
        }
      );

      return { email: response.data.email };
    } catch (error) {
      const message =
        error.response?.data?.error?.message || 'Failed to send verification email';
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, message);
    }
  }

  /**
   * Confirm email verification
   */
  async verifyEmail(oobCode) {
    try {
      const response = await axios.post(
        `${FIREBASE_AUTH_REST}/accounts:update?key=${FIREBASE_API_KEY}`,
        {
          oobCode,
        }
      );

      const uid = response.data.localId;

      // Update Firestore
      await db.collection('users').doc(uid).update({
        isVerified: true,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        email: response.data.email,
        emailVerified: response.data.emailVerified,
      };
    } catch (error) {
      const message =
        error.response?.data?.error?.message || 'Failed to verify email';
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, message);
    }
  }

  /**
   * Change password (requires current password)
   */
  async changePassword(uid, email, currentPassword, newPassword) {
    // Re-authenticate
    await this._signInWithEmailPassword(email, currentPassword);

    await auth.updateUser(uid, {
      password: newPassword,
    });

    // Revoke old tokens for security
    await auth.revokeRefreshTokens(uid);

    return true;
  }

  /**
   * Get current user profile
   */
  async getMe(uid) {
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const data = userDoc.data();

    return {
      uid: data.uid,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      role: data.role,
      profileImage: data.profileImage,
      isVerified: data.isVerified,
      isActive: data.isActive,
      referralCode: data.referralCode,
      referredBy: data.referredBy || null,
      balance: data.balance || 0,
      sharesOwned: data.sharesOwned || 0,
      totalInvested: data.totalInvested || 0,
      totalReferralEarnings: data.totalReferralEarnings || 0,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      lastLogin: data.lastLogin,
    };
  }

  /**
   * Update profile (self only)
   */
  async updateProfile(uid, updates) {
    const allowed = ['fullName', 'phone', 'profileImage'];
    const cleanUpdates = {};

    allowed.forEach((key) => {
      if (updates[key] !== undefined) {
        cleanUpdates[key] = updates[key];
      }
    });

    if (Object.keys(cleanUpdates).length === 0) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'No valid fields to update');
    }

    cleanUpdates.updatedAt = FieldValue.serverTimestamp();

    await db.collection('users').doc(uid).update(cleanUpdates);

    // Also update displayName in Auth if fullName changed
    if (cleanUpdates.fullName) {
      await auth.updateUser(uid, {
        displayName: cleanUpdates.fullName,
      });
    }

    return this.getMe(uid);
  }

  /**
   * Delete account (self or admin)
   */
  async deleteAccount(uid, requester) {
    // Only the owner or an admin can delete
    if (requester.uid !== uid && requester.role !== ROLES.ADMIN) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, MESSAGES.FORBIDDEN);
    }

    // Delete from Auth
    await auth.deleteUser(uid);

    // Delete from Firestore
    await db.collection('users').doc(uid).delete();

    logger.info(`Account deleted: ${uid} by ${requester.uid}`);
    return true;
  }

  /**
   * Helper – sign in with email/password via REST API
   */
  async _signInWithEmailPassword(email, password) {
    try {
      const response = await axios.post(
        `${FIREBASE_AUTH_REST}/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
        {
          email,
          password,
          returnSecureToken: true,
        }
      );

      return {
        idToken: response.data.idToken,
        refreshToken: response.data.refreshToken,
        expiresIn: response.data.expiresIn,
        localId: response.data.localId,
      };
    } catch (error) {
      const firebaseError = error.response?.data?.error?.message;

      if (
        firebaseError === 'EMAIL_NOT_FOUND' ||
        firebaseError === 'INVALID_PASSWORD' ||
        firebaseError === 'INVALID_LOGIN_CREDENTIALS'
      ) {
        throw new ApiError(HTTP_STATUS.UNAUTHORIZED, MESSAGES.INVALID_CREDENTIALS);
      }

      if (firebaseError === 'USER_DISABLED') {
        throw new ApiError(HTTP_STATUS.FORBIDDEN, MESSAGES.ACCOUNT_DISABLED);
      }

      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        firebaseError || 'Authentication failed'
      );
    }
  }
}

module.exports = new AuthService();
