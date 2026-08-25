const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, SHARES } = require('../utils/constants');

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

    // Value holdings at the live configured price, not the SHARES.PRICE constant
    // — otherwise a price change in config/shares is invisible here.
    const { pricePerShare } = await this.getShareInfo();
    const sharesOwned = data.sharesOwned || 0;
    const totalInvested = data.totalInvested || 0;

    return {
      sharesOwned,
      totalInvested,
      pricePerShare,
      currentValue: sharesOwned * pricePerShare,
      totalReturns: sharesOwned * pricePerShare - totalInvested,
      purchases,
    };
  }
}

module.exports = new ShareService();
