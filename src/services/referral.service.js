const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES, REFERRAL_RATES, SHARES } = require('../utils/constants');
const { logger } = require('../utils/logger');
const maskEmail = require('../utils/maskEmail');
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
   * Get referral stats for a user, covering both commission levels.
   *
   * Level 2 is enumerated (not just counted) and earnings are split per level
   * from the `commissions` ledger, so the dashboard can show where money came
   * from rather than a single opaque total.
   */
  async getReferralStats(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const user = userDoc.data();

    // ---- Level 1: people who signed up with my code ----
    const level1Snap = await db.collection('users').where('referredBy', '==', uid).get();

    const level1Uids = level1Snap.docs.map((d) => d.id);
    const level1Users = level1Snap.docs.map((d) => this._publicReferral(d, 1));

    // ---- Level 2: people referred by my level-1 users ----
    const level2Users = [];
    for (const batch of this._chunk(level1Uids, 30)) {
      const snap = await db.collection('users').where('referredBy', 'in', batch).get();
      snap.docs.forEach((d) => level2Users.push(this._publicReferral(d, 2)));
    }

    // ---- Earnings split per level, from the commission ledger ----
    const earnings = await this._earningsByLevel(uid);

    return {
      referralCode: user.referralCode,
      referredBy: user.referredBy || null,
      balance: user.balance || 0,
      totalReferralEarnings: user.totalReferralEarnings || 0,
      directReferrals: level1Users.length,
      secondLevelReferrals: level2Users.length,
      totalReferrals: level1Users.length + level2Users.length,
      level1Users,
      level2Users,
      earnings: {
        level1: earnings.level1,
        level2: earnings.level2,
        total: Number((earnings.level1 + earnings.level2).toFixed(2)),
      },
      // Commissions are a cut of a USD purchase total, so earnings are USD.
      currency: SHARES.CURRENCY,
      rates: {
        level1: `${REFERRAL_RATES.LEVEL_1}%`,
        level2: `${REFERRAL_RATES.LEVEL_2}%`,
        level1Percent: REFERRAL_RATES.LEVEL_1,
        level2Percent: REFERRAL_RATES.LEVEL_2,
      },
    };
  }

  /**
   * Only the fields that are safe to expose about someone else's account.
   */
  _publicReferral(doc, level) {
    const data = doc.data();
    return {
      uid: doc.id,
      fullName: data.fullName || null,
      email: maskEmail(data.email),
      level,
      sharesOwned: data.sharesOwned || 0,
      totalInvested: data.totalInvested || 0,
      isVerified: Boolean(data.isVerified),
      createdAt: data.createdAt || null,
    };
  }

  /**
   * Sum the commission ledger per level. The ledger is the source of truth for
   * "where did my earnings come from"; the denormalised
   * `users.totalReferralEarnings` counter stays the fast path for the total.
   */
  async _earningsByLevel(uid) {
    const snap = await db.collection('commissions').where('toUid', '==', uid).get();

    const totals = { level1: 0, level2: 0 };

    snap.docs.forEach((d) => {
      const c = d.data();
      const key = c.level === 2 ? 'level2' : 'level1';
      totals[key] += Number(c.amount) || 0;
    });

    return {
      level1: Number(totals.level1.toFixed(2)),
      level2: Number(totals.level2.toFixed(2)),
    };
  }

  /**
   * Firestore caps `in` queries at 30 values, so batch anything larger.
   */
  _chunk(items, size) {
    const batches = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }

  /**
   * Distribute commissions up the referral chain when a user buys shares.
   *
   * Walks the upline one level at a time, paying the rate configured for that
   * level. Levels are data (REFERRAL_RATES), so adding a level 3 is a config
   * change rather than another copy of this block.
   *
   * @param {string} buyerUid - the user who paid
   * @param {number} amount - the transaction amount commissions are a cut of
   * @param {string} transactionId - makes each credit idempotent; always pass it
   */
  async distributeCommissions(buyerUid, amount, transactionId = null) {
    const buyerDoc = await db.collection('users').doc(buyerUid).get();
    if (!buyerDoc.exists) return [];

    if (!transactionId) {
      // Without one, _creditCommission cannot dedupe and a webhook + client
      // verify race would pay the upline twice.
      logger.warn(`distributeCommissions called without a transactionId for ${buyerUid}`);
    }

    const rates = this._levelRates();
    const commissions = [];

    // Guard against a referral cycle (bad data: A→B→A) walking forever.
    const visited = new Set([buyerUid]);
    let currentUid = buyerDoc.data().referredBy || null;

    for (let level = 1; level <= rates.length && currentUid; level += 1) {
      if (visited.has(currentUid)) {
        logger.error(
          `Referral cycle detected walking upline from ${buyerUid} at level ${level}; stopping`
        );
        break;
      }
      visited.add(currentUid);

      const rate = rates[level - 1];
      const commissionAmount = Number(((amount * rate) / 100).toFixed(2));

      if (commissionAmount > 0) {
        const credited = await this._creditCommission(currentUid, commissionAmount, {
          fromUid: buyerUid,
          level,
          baseAmount: amount,
          rate,
          transactionId,
        });

        commissions.push({
          uid: currentUid,
          level,
          amount: commissionAmount,
          rate,
          skipped: !credited,
        });
      }

      // Step up to the next level's beneficiary.
      const upline = await db.collection('users').doc(currentUid).get();
      currentUid = upline.exists ? upline.data().referredBy || null : null;
    }

    logger.info(
      `Commissions for buyer ${buyerUid} on ${amount}: ${JSON.stringify(commissions)}`
    );

    return commissions;
  }

  /**
   * Commission rate per level, ordered level 1 → N.
   */
  _levelRates() {
    return [REFERRAL_RATES.LEVEL_1, REFERRAL_RATES.LEVEL_2].filter(
      (rate) => Number.isFinite(rate) && rate > 0
    );
  }

  /**
   * Internal helper to credit a user and log the commission.
   *
   * When a transactionId is supplied the commission doc gets a deterministic id
   * (`<transactionId>_L<level>`), which makes this idempotent: a replayed payment
   * completion finds the doc already there and credits nothing a second time.
   *
   * @returns {Promise<boolean>} true if credited, false if skipped as a duplicate
   */
  async _creditCommission(uid, amount, meta) {
    const userRef = db.collection('users').doc(uid);
    const commissionRef = meta.transactionId
      ? db.collection('commissions').doc(`${meta.transactionId}_L${meta.level}`)
      : db.collection('commissions').doc();

    let credited = false;

    await db.runTransaction(async (tx) => {
      credited = false; // reset: Firestore may retry this callback

      // ========== ALL READS FIRST ==========
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) return;

      if (meta.transactionId) {
        const existing = await tx.get(commissionRef);
        if (existing.exists) {
          logger.info(
            `Commission ${commissionRef.id} already credited to ${uid}; skipping duplicate`
          );
          return;
        }
      }

      // ========== ALL WRITES AFTER READS ==========
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

      credited = true;
    });

    return credited;
  }
}

module.exports = new ReferralService();
