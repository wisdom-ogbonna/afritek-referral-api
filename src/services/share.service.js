const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES, SHARES } = require('../utils/constants');
const { logger } = require('../utils/logger');

class ShareService {
  /**
   * Get current share inventory & pricing
   */
  async getShareInfo() {
    const ref = db.collection('config').doc('shares');
    let snap = await ref.get();

    if (!snap.exists) {
      // Auto-seed if missing
      await ref.set({
        totalShares: SHARES.TOTAL,
        remainingShares: SHARES.TOTAL,
        pricePerShare: SHARES.PRICE,
        currency: SHARES.CURRENCY,
        soldShares: 0,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
      snap = await ref.get();
    }

    const data = snap.data();
    return {
      totalShares: data.totalShares,
      remainingShares: data.remainingShares,
      soldShares: data.soldShares || 0,
      pricePerShare: data.pricePerShare,
      currency: data.currency,
      totalValue: data.totalShares * data.pricePerShare,
    };
  }

  /**
   * Reserve shares (called inside payment success transaction)
   * Returns false if not enough shares left
   */
  async reserveShares(quantity, tx) {
    const ref = db.collection('config').doc('shares');
    const snap = await tx.get(ref);

    if (!snap.exists) {
      throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Shares config missing');
    }

    const data = snap.data();
    if (data.remainingShares < quantity) {
      return false;
    }

    tx.update(ref, {
      remainingShares: FieldValue.increment(-quantity),
      soldShares: FieldValue.increment(quantity),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return true;
  }

  /**
   * Credit shares to a user after successful payment
   */
  async creditSharesToUser(uid, quantity, amountPaid, paymentId, gateway, tx) {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);

    if (!userSnap.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    tx.update(userRef, {
      sharesOwned: FieldValue.increment(quantity),
      totalInvested: FieldValue.increment(amountPaid),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Record purchase
    const purchaseRef = db.collection('purchases').doc();
    tx.set(purchaseRef, {
      id: purchaseRef.id,
      uid,
      quantity,
      amountPaid,
      pricePerShare: SHARES.PRICE,
      paymentId,
      gateway,
      status: 'completed',
      createdAt: FieldValue.serverTimestamp(),
    });

    return purchaseRef.id;
  }

  /**
   * Get user's share holdings
   */
  async getMyShares(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const data = userDoc.data();
    const purchasesSnap = await db
      .collection('purchases')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const purchases = purchasesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return {
      sharesOwned: data.sharesOwned || 0,
      totalInvested: data.totalInvested || 0,
      currentValue: (data.sharesOwned || 0) * SHARES.PRICE,
      purchases,
    };
  }
}

module.exports = new ShareService();
