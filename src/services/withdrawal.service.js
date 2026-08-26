const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const {
  HTTP_STATUS,
  MESSAGES,
  WITHDRAWAL_STATUS,
  ROLES,
  WITHDRAWAL,
} = require('../utils/constants');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class WithdrawalService {
  /**
   * Request a withdrawal from wallet balance.
   *
   * Amounts here are USD, because the balance they come out of is: commissions
   * are a percentage of a USD purchase total. The payout leg to a Nigerian bank
   * account still has to convert to Naira — that conversion belongs to whoever
   * processes the transfer, and the rate it settles at is recorded there, not
   * assumed here.
   */
  async requestWithdrawal(uid, amount, bankDetails) {
    const min = WITHDRAWAL.MIN_USD;

    if (amount < min) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        `Minimum withdrawal amount is $${min}`
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

    const feePercent = WITHDRAWAL.FEE_PERCENT;
    const fee = Number(((amount * feePercent) / 100).toFixed(2));
    const netAmount = Number((amount - fee).toFixed(2));

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
        currency: WITHDRAWAL.CURRENCY,
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

    logger.info(`Withdrawal requested: ${withdrawalId} by ${uid} for $${amount}`);

    return {
      withdrawalId,
      amount,
      fee,
      netAmount,
      currency: WITHDRAWAL.CURRENCY,
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
   * Admin: approve or reject.
   *
   * The status check happens INSIDE the transaction, and that placement is the
   * whole point. It used to run against a snapshot read beforehand, while the
   * refund ran in a transaction of its own — so two admins rejecting the same
   * request at the same time both read `pending`, both passed the guard, and both
   * credited `+amount` back to the user. The balance was refunded twice for one
   * withdrawal. Reading the doc through `tx` makes Firestore retry or abort the
   * loser instead.
   *
   * Approve does not move money: the balance was already debited as a hold when
   * the request was made, so approving only records that the payout happened.
   * The bank transfer itself is performed out of band — nothing here talks to a
   * gateway, and `processedBy`/`processedAt`/`note` are the audit trail for it.
   */
  async processWithdrawal(withdrawalId, action, adminUid, note = '') {
    if (!['approve', 'reject'].includes(action)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Action must be approve or reject');
    }

    const wRef = db.collection('withdrawals').doc(withdrawalId);
    const rejecting = action === 'reject';
    const status = rejecting ? WITHDRAWAL_STATUS.REJECTED : WITHDRAWAL_STATUS.COMPLETED;

    const result = await db.runTransaction(async (tx) => {
      const wSnap = await tx.get(wRef);

      if (!wSnap.exists) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Withdrawal not found');
      }

      const withdrawal = wSnap.data();

      if (withdrawal.status !== WITHDRAWAL_STATUS.PENDING) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          MESSAGES.WITHDRAWAL_ALREADY_PROCESSED
        );
      }

      tx.update(wRef, {
        status,
        processedBy: adminUid,
        processedAt: FieldValue.serverTimestamp(),
        note,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (rejecting) {
        // Release the hold taken in requestWithdrawal().
        tx.update(db.collection('users').doc(withdrawal.uid), {
          balance: FieldValue.increment(withdrawal.amount),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        status,
        uid: withdrawal.uid,
        amount: withdrawal.amount,
        netAmount: withdrawal.netAmount,
        currency: withdrawal.currency || WITHDRAWAL.CURRENCY,
      };
    });

    logger.info(
      `Withdrawal ${withdrawalId} ${status} by ${adminUid}` +
        (rejecting ? ` — $${result.amount} returned to ${result.uid}` : '')
    );

    return result;
  }
}

module.exports = new WithdrawalService();
