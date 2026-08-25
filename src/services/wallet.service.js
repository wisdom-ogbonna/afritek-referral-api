const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS } = require('../utils/constants');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class WalletService {
  /**
   * Admin-only manual balance credit.
   *
   * This used to be a self-service `deposit` any authenticated user could call,
   * which let anyone mint balance for themselves for free AND trigger real
   * referral commissions up their own upline — money out of the business with no
   * payment behind it. It is now an admin adjustment tool (route is gated with
   * authorize(ROLES.ADMIN)), and it deliberately does NOT pay commissions:
   * commissions are earned on gateway-verified share purchases only, in
   * paymentService.completePayment().
   */
  async adminCredit(targetUid, amount, adminUid, description = 'Manual credit') {
    if (!(amount > 0)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Amount must be greater than zero');
    }

    const userRef = db.collection('users').doc(targetUid);
    const txId = uuidv4();

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
      }

      tx.update(userRef, {
        balance: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const txRef = db.collection('transactions').doc(txId);
      tx.set(txRef, {
        id: txId,
        uid: targetUid,
        type: 'admin_credit',
        amount,
        description,
        performedBy: adminUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    logger.warn(`Admin ${adminUid} credited ₦${amount} to ${targetUid} (tx ${txId})`);

    const updatedUser = await userRef.get();

    return {
      transactionId: txId,
      uid: targetUid,
      amount,
      newBalance: updatedUser.data().balance || 0,
    };
  }

  /**
   * Wallet overview: withdrawable balance, referral earnings and holdings.
   *
   * Holdings are included because the wallet screen shows them alongside the
   * balance — one call instead of the client stitching two responses together.
   */
  async getWallet(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const data = userDoc.data();

    const commissionsSnap = await db
      .collection('commissions')
      .where('toUid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const recentCommissions = commissionsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    const sharesOwned = data.sharesOwned || 0;
    const totalInvested = data.totalInvested || 0;
    const pricePerShare = await this._currentSharePrice();

    return {
      balance: data.balance || 0,
      totalReferralEarnings: data.totalReferralEarnings || 0,
      sharesOwned,
      totalInvested,
      pricePerShare,
      currentValue: sharesOwned * pricePerShare,
      // Unrealised gain on holdings — the "Total Returns" figure on the wallet tab.
      totalReturns: sharesOwned * pricePerShare - totalInvested,
      recentCommissions,
    };
  }

  /**
   * Live share price from config, so a price change is reflected everywhere
   * rather than each caller baking in the seed-time constant.
   */
  async _currentSharePrice() {
    const snap = await db.collection('config').doc('shares').get();
    const { SHARES } = require('../utils/constants');
    return snap.exists ? snap.data().pricePerShare || SHARES.PRICE : SHARES.PRICE;
  }
}

module.exports = new WalletService();
