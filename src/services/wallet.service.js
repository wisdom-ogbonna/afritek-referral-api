const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');
const referralService = require('./referral.service');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class WalletService {
  /**
   * Deposit / Purchase that triggers referral commissions
   */
  async deposit(uid, amount, description = 'Deposit') {
    if (amount <= 0) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Amount must be greater than zero');
    }

    const userRef = db.collection('users').doc(uid);
    const txId = uuidv4();

    // Credit the user's own balance (the deposited amount)
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
      }

      tx.update(userRef, {
        balance: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Log the transaction
      const txRef = db.collection('transactions').doc(txId);
      tx.set(txRef, {
        id: txId,
        uid,
        type: 'deposit',
        amount,
        description,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    // Distribute referral commissions (15% L1, 5% L2)
    const commissions = await referralService.distributeCommissions(uid, amount, txId);

    logger.info(`Deposit of ${amount} by ${uid}. Commissions: ${JSON.stringify(commissions)}`);

    // Return updated balance
    const updatedUser = await userRef.get();
    const data = updatedUser.data();

    return {
      transactionId: txId,
      amount,
      newBalance: data.balance || 0,
      commissions,
    };
  }

  /**
   * Get wallet / balance info
   */
  async getWallet(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const data = userDoc.data();

    // Recent commissions
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

    return {
      balance: data.balance || 0,
      totalReferralEarnings: data.totalReferralEarnings || 0,
      recentCommissions,
    };
  }
}

module.exports = new WalletService();
