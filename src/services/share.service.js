const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, SHARES } = require('../utils/constants');
const { logger } = require('../utils/logger');

class ShareService {
  /**
   * Resolve the current share price in USD.
   *
   * Two price sources used to exist — the env constant (via SHARES.PRICE, used
   * to CHARGE) and the config/shares Firestore doc (used to QUOTE). They could
   * diverge, so a buyer could be shown one price and charged another. This is
   * the single resolver both paths now call: the env value is authoritative,
   * and it is written through to config/shares whenever it differs.
   *
   * The write-through deliberately replaces the old create-only behaviour in
   * seedShares.js and the duplicate auto-seed here. config/shares is live
   * configuration, not transaction history — repricing it does not touch a
   * single purchase or commission row.
   */
  async getPriceUsd() {
    const ref = db.collection('config').doc('shares');
    const snap = await ref.get();

    const priceUsd = SHARES.PRICE_USD;

    if (!snap.exists) {
      // Auto-seed if missing, ditto getShareInfo below.
      await ref.set({
        totalShares: SHARES.TOTAL,
        remainingShares: SHARES.TOTAL,
        pricePerShare: priceUsd,
        currency: SHARES.CURRENCY,
        soldShares: 0,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
      return priceUsd;
    }

    const data = snap.data();

    if (data.pricePerShare !== priceUsd || data.currency !== SHARES.CURRENCY) {
      // Keep the inventory counters, update only the price + currency. Done
      // outside a transaction: the race is benign (worst case the value ends up
      // correct on the next call), and a failed single write is not worth
      // failing a purchase over.
      await ref
        .update({ pricePerShare: priceUsd, currency: SHARES.CURRENCY })
        .catch((err) => {
          logger.error(`Could not sync config/shares price to $${priceUsd}: ${err.message}`);
        });
    }

    return priceUsd;
  }

  /**
   * Get current share inventory & pricing.
   *
   * Seeding and price write-through both live in getPriceUsd(), so this reads
   * the doc only for the inventory counters.
   */
  async getShareInfo() {
    const pricePerShare = await this.getPriceUsd();

    const snap = await db.collection('config').doc('shares').get();
    const data = snap.data();

    return {
      totalShares: data.totalShares,
      remainingShares: data.remainingShares,
      soldShares: data.soldShares || 0,
      pricePerShare,
      currency: SHARES.CURRENCY,
      totalValue: data.totalShares * pricePerShare,
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

    // Value holdings at the live configured price, not a hardcoded constant —
    // otherwise a price change is invisible here.
    const pricePerShare = await this.getPriceUsd();
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
