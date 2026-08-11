const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES, REFERRAL_RATES } = require('../utils/constants');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class ReferralService {
  /**
   * Generate a unique short referral code
   */
  async generateUniqueReferralCode(fullName) {
    const base = fullName
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 6)
      .toUpperCase() || 'USER';

    let code;
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 10) {
      const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      code = `${base}${suffix}`;
      const snapshot = await db
        .collection('users')
        .where('referralCode', '==', code)
        .limit(1)
        .get();
      exists = !snapshot.empty;
      attempts += 1;
    }

    if (exists) {
      // Fallback to uuid based
      code = uuidv4().replace(/-/g, '').substring(0, 10).toUpperCase();
    }

    return code;
  }

  /**
   * Resolve a referral code to a user uid
   */
  async resolveReferralCode(referralCode) {
    if (!referralCode) return null;

    const snapshot = await db
      .collection('users')
      .where('referralCode', '==', referralCode.trim().toUpperCase())
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INVALID_REFERRAL_CODE);
    }

    const doc = snapshot.docs[0];
    return {
      uid: doc.id,
      ...doc.data(),
    };
  }

  /**
   * Get referral stats for a user
   */
  async getReferralStats(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const user = userDoc.data();

    // Count direct referrals (level 1)
    const level1Snap = await db
      .collection('users')
      .where('referredBy', '==', uid)
      .get();

    const level1Count = level1Snap.size;
    const level1Users = level1Snap.docs.map((d) => ({
      uid: d.id,
      fullName: d.data().fullName,
      email: d.data().email,
      createdAt: d.data().createdAt,
    }));

    // Count level 2 (referrals of my referrals)
    let level2Count = 0;
    const level1Uids = level1Snap.docs.map((d) => d.id);

    if (level1Uids.length > 0) {
      // Firestore 'in' supports max 30, so batch if needed
      const batches = [];
      for (let i = 0; i < level1Uids.length; i += 30) {
        batches.push(level1Uids.slice(i, i + 30));
      }

      for (const batch of batches) {
        const snap = await db
          .collection('users')
          .where('referredBy', 'in', batch)
          .get();
        level2Count += snap.size;
      }
    }

    return {
      referralCode: user.referralCode,
      balance: user.balance || 0,
      totalReferralEarnings: user.totalReferralEarnings || 0,
      directReferrals: level1Count,
      secondLevelReferrals: level2Count,
      level1Users,
      rates: {
        level1: `${REFERRAL_RATES.LEVEL_1}%`,
        level2: `${REFERRAL_RATES.LEVEL_2}%`,
      },
    };
  }

  /**
   * Distribute commissions up to 2 levels when a user makes a deposit/purchase
   * @param {string} buyerUid - The user who made the purchase/deposit
   * @param {number} amount - The amount of the transaction
   * @param {string} transactionId - Optional reference
   */
  async distributeCommissions(buyerUid, amount, transactionId = null) {
    const buyerDoc = await db.collection('users').doc(buyerUid).get();
    if (!buyerDoc.exists) return [];

    const buyer = buyerDoc.data();
    const commissions = [];

    // Level 1 - Direct referrer
    if (buyer.referredBy) {
      const level1Uid = buyer.referredBy;
      const level1Amount = Number(((amount * REFERRAL_RATES.LEVEL_1) / 100).toFixed(2));

      if (level1Amount > 0) {
        await this._creditCommission(level1Uid, level1Amount, {
          fromUid: buyerUid,
          level: 1,
          baseAmount: amount,
          rate: REFERRAL_RATES.LEVEL_1,
          transactionId,
        });
        commissions.push({ uid: level1Uid, level: 1, amount: level1Amount });
      }

      // Level 2 - Referrer of the referrer
      const level1Doc = await db.collection('users').doc(level1Uid).get();
      if (level1Doc.exists) {
        const level1User = level1Doc.data();
        if (level1User.referredBy) {
          const level2Uid = level1User.referredBy;
          const level2Amount = Number(((amount * REFERRAL_RATES.LEVEL_2) / 100).toFixed(2));

          if (level2Amount > 0) {
            await this._creditCommission(level2Uid, level2Amount, {
              fromUid: buyerUid,
              level: 2,
              baseAmount: amount,
              rate: REFERRAL_RATES.LEVEL_2,
              transactionId,
            });
            commissions.push({ uid: level2Uid, level: 2, amount: level2Amount });
          }
        }
      }
    }

    logger.info(
      `Commissions distributed for buyer ${buyerUid} amount ${amount}: ${JSON.stringify(commissions)}`
    );

    return commissions;
  }

  /**
   * Internal helper to credit a user and log the commission
   */
  async _creditCommission(uid, amount, meta) {
    const userRef = db.collection('users').doc(uid);
    const commissionRef = db.collection('commissions').doc();

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) return;

      tx.update(userRef, {
        balance: FieldValue.increment(amount),
        totalReferralEarnings: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(commissionRef, {
        id: commissionRef.id,
        toUid: uid,
        fromUid: meta.fromUid,
        level: meta.level,
        amount,
        baseAmount: meta.baseAmount,
        rate: meta.rate,
        transactionId: meta.transactionId || null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  }
}

module.exports = new ReferralService();
