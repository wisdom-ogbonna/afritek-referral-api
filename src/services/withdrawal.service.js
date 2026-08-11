const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const {
  HTTP_STATUS,
  MESSAGES,
  WITHDRAWAL_STATUS,
  ROLES,
} = require('../utils/constants');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class WithdrawalService {
  /**
   * Request a withdrawal from wallet balance
   */
  async requestWithdrawal(uid, amount, bankDetails) {
    const min = parseInt(process.env.MIN_WITHDRAWAL, 10) || 1000;

    if (amount < min) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        `Minimum withdrawal amount is ₦${min}`
      );
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const user = userSnap.data();
    const balance = user.balance || 0;

    if (balance < amount) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INSUFFICIENT_BALANCE);
    }

    const feePercent = parseFloat(process.env.WITHDRAWAL_FEE_PERCENT) || 0;
    const fee = Number(((amount * feePercent) / 100).toFixed(2));
    const netAmount = amount - fee;

    const withdrawalId = uuidv4();

    // Deduct balance immediately (hold)
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(userRef);
      const currentBalance = fresh.data().balance || 0;

      if (currentBalance < amount) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INSUFFICIENT_BALANCE);
      }

      tx.update(userRef, {
        balance: FieldValue.increment(-amount),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const wRef = db.collection('withdrawals').doc(withdrawalId);
      tx.set(wRef, {
        id: withdrawalId,
        uid,
        amount,
        fee,
        netAmount,
        currency: 'NGN',
        bankDetails: {
          accountName: bankDetails.accountName,
          accountNumber: bankDetails.accountNumber,
          bankCode: bankDetails.bankCode,
          bankName: bankDetails.bankName || null,
        },
        status: WITHDRAWAL_STATUS.PENDING,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    logger.info(`Withdrawal requested: ${withdrawalId} by ${uid} for ₦${amount}`);

    return {
      withdrawalId,
      amount,
      fee,
      netAmount,
      status: WITHDRAWAL_STATUS.PENDING,
    };
  }

  /**
   * Get my withdrawal history
   */
  async getMyWithdrawals(uid) {
    const snap = await db
      .collection('withdrawals')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  /**
   * Admin: list all pending withdrawals
   */
  async listPending() {
    const snap = await db
      .collection('withdrawals')
      .where('status', '==', WITHDRAWAL_STATUS.PENDING)
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  /**
   * Admin: approve or reject
   */
  async processWithdrawal(withdrawalId, action, adminUid, note = '') {
    if (!['approve', 'reject'].includes(action)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Action must be approve or reject');
    }

    const wRef = db.collection('withdrawals').doc(withdrawalId);
    const wSnap = await wRef.get();

    if (!wSnap.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Withdrawal not found');
    }

    const withdrawal = wSnap.data();

    if (withdrawal.status !== WITHDRAWAL_STATUS.PENDING) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Withdrawal already processed');
    }

    if (action === 'reject') {
      // Refund balance
      await db.runTransaction(async (tx) => {
        tx.update(wRef, {
          status: WITHDRAWAL_STATUS.REJECTED,
          processedBy: adminUid,
          processedAt: FieldValue.serverTimestamp(),
          note,
          updatedAt: FieldValue.serverTimestamp(),
        });

        const userRef = db.collection('users').doc(withdrawal.uid);
        tx.update(userRef, {
          balance: FieldValue.increment(withdrawal.amount),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      return { status: WITHDRAWAL_STATUS.REJECTED };
    }

    // Approve → mark as completed (in real system you would trigger Paystack Transfer here)
    await wRef.update({
      status: WITHDRAWAL_STATUS.COMPLETED,
      processedBy: adminUid,
      processedAt: FieldValue.serverTimestamp(),
      note,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info(`Withdrawal ${withdrawalId} approved by ${adminUid}`);

    return { status: WITHDRAWAL_STATUS.COMPLETED };
  }
}

module.exports = new WithdrawalService();
