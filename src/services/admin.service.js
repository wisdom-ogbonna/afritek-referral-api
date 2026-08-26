const { db, auth, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const {
  HTTP_STATUS,
  MESSAGES,
  ROLES,
  PAYMENT_STATUS,
  WITHDRAWAL_STATUS,
  PAYMENT_GATEWAYS,
  SHARES,
  WITHDRAWAL,
} = require('../utils/constants');
const { logger } = require('../utils/logger');
const shareService = require('./share.service');
const fxService = require('./fx.service');

/** Hard ceiling on any page size, so `?limit=100000` cannot be used to pull the
 *  whole user base in one request. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/**
 * Read-side aggregation for the admin console.
 *
 * Deliberately thin: pricing comes from shareService, FX from fxService, and
 * withdrawal approval from withdrawalService. Nothing here recomputes a price,
 * a rate or a payout — duplicating any of those is how the two-price-source bug
 * that prompted the USD reprice happened in the first place.
 */
class AdminService {
  // ==================== helpers ====================

  /** Firestore Timestamp | Date | null → ISO string | null, for JSON responses. */
  _iso(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return null;
  }

  _limit(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
  }

  /**
   * Apply `createdAt desc` ordering plus an optional cursor.
   *
   * The cursor is the previous page's last `createdAt` as epoch millis, because
   * a DocumentSnapshot cannot survive a round trip to the browser. Two documents
   * written in the same millisecond could in principle straddle a page boundary;
   * at this volume that is an acceptable trade for not having to hand a client
   * an opaque snapshot handle.
   */
  _paginate(query, { limit, startAfter } = {}) {
    let q = query.orderBy('createdAt', 'desc');

    const cursor = Number(startAfter);
    if (Number.isFinite(cursor) && cursor > 0) {
      q = q.startAfter(new Date(cursor));
    }

    return q.limit(this._limit(limit));
  }

  /**
   * Shape a page result the same way for every list endpoint.
   *
   * `nextCursor` is null when the page came back short, which is the signal the
   * UI uses to stop offering "load more".
   */
  _page(docs, limit, mapper) {
    const items = docs.map(mapper);
    const full = docs.length === this._limit(limit);
    const last = items[items.length - 1];

    return {
      items,
      nextCursor: full && last?.createdAt ? Date.parse(last.createdAt) : null,
    };
  }

  /**
   * Turn Firestore's missing-index error into something an operator can act on.
   *
   * Filtered + ordered queries need composite indexes. Without this the console
   * shows a generic 500 and the actual fix — a URL Firestore puts in the error
   * message — is buried in the API logs.
   */
  async _run(query, context) {
    try {
      return await query.get();
    } catch (error) {
      if (error.code === 9 || error.code === 'failed-precondition') {
        logger.error(`Missing Firestore index for ${context}: ${error.message}`);
        throw new ApiError(
          HTTP_STATUS.SERVICE_UNAVAILABLE,
          `This view needs a Firestore composite index that has not been created yet. ` +
            `Deploy firestore.indexes.json, or open the URL in the API logs to create it.`
        );
      }
      throw error;
    }
  }

  async _count(query, fallbackContext) {
    try {
      const snap = await query.count().get();
      return snap.data().count;
    } catch (error) {
      logger.error(`Count failed for ${fallbackContext}: ${error.message}`);
      return null;
    }
  }

  // ==================== overview ====================

  /**
   * Platform totals for the landing page of the console.
   *
   * Counts use Firestore's count() aggregation, which bills reads by index
   * entries scanned rather than documents returned. Revenue is the one figure
   * that needs real values, so it projects a single field with select() instead
   * of pulling whole payment documents. That is fine at current volume and is
   * the first thing to replace with a running total if `payments` gets large.
   */
  async getOverview() {
    const users = db.collection('users');
    const payments = db.collection('payments');
    const withdrawals = db.collection('withdrawals');

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      verifiedUsers,
      newUsers,
      completedPayments,
      pendingPayments,
      pendingWithdrawalCount,
      shareInfo,
      revenueSnap,
      pendingWithdrawalSnap,
      recentPaymentsSnap,
      recentWithdrawalsSnap,
    ] = await Promise.all([
      this._count(users, 'users'),
      this._count(users.where('isActive', '==', true), 'active users'),
      this._count(users.where('isVerified', '==', true), 'verified users'),
      this._count(users.where('createdAt', '>=', weekAgo), 'new users'),
      this._count(
        payments.where('status', '==', PAYMENT_STATUS.COMPLETED),
        'completed payments'
      ),
      this._count(
        payments.where('status', '==', PAYMENT_STATUS.PENDING),
        'pending payments'
      ),
      this._count(
        withdrawals.where('status', '==', WITHDRAWAL_STATUS.PENDING),
        'pending withdrawals'
      ),
      shareService.getShareInfo(),
      payments
        .where('status', '==', PAYMENT_STATUS.COMPLETED)
        .select('amountUsd', 'amount')
        .get(),
      withdrawals
        .where('status', '==', WITHDRAWAL_STATUS.PENDING)
        .select('amount', 'netAmount')
        .get(),
      payments.orderBy('createdAt', 'desc').limit(10).get(),
      withdrawals.orderBy('createdAt', 'desc').limit(10).get(),
    ]);

    // amountUsd is the ledger figure; `amount` is its long-standing alias and is
    // what pre-reprice documents carry.
    const revenueUsd = revenueSnap.docs.reduce((sum, doc) => {
      const d = doc.data();
      return sum + Number(d.amountUsd ?? d.amount ?? 0);
    }, 0);

    const pendingWithdrawalUsd = pendingWithdrawalSnap.docs.reduce(
      (sum, doc) => sum + Number(doc.data().amount || 0),
      0
    );

    return {
      currency: SHARES.CURRENCY,
      users: {
        total: totalUsers,
        active: activeUsers,
        verified: verifiedUsers,
        newThisWeek: newUsers,
      },
      payments: {
        completed: completedPayments,
        pending: pendingPayments,
        revenueUsd: Number(revenueUsd.toFixed(2)),
      },
      shares: shareInfo,
      withdrawals: {
        pending: pendingWithdrawalCount,
        pendingAmountUsd: Number(pendingWithdrawalUsd.toFixed(2)),
      },
      recentPayments: recentPaymentsSnap.docs.map((d) => this._mapPayment(d)),
      recentWithdrawals: recentWithdrawalsSnap.docs.map((d) => this._mapWithdrawal(d)),
    };
  }

  // ==================== users ====================

  _mapUser(doc) {
    const d = doc.data();
    return {
      uid: d.uid || doc.id,
      fullName: d.fullName || null,
      email: d.email || null,
      phone: d.phone || null,
      role: d.role || ROLES.USER,
      isActive: d.isActive !== false,
      isVerified: Boolean(d.isVerified),
      referralCode: d.referralCode || null,
      referredBy: d.referredBy || null,
      balance: Number(d.balance || 0),
      sharesOwned: Number(d.sharesOwned || 0),
      totalInvested: Number(d.totalInvested || 0),
      totalReferralEarnings: Number(d.totalReferralEarnings || 0),
      createdAt: this._iso(d.createdAt),
      lastLogin: this._iso(d.lastLogin),
    };
  }

  /**
   * List users, newest first.
   *
   * `search` is an email PREFIX match, not a substring one: Firestore has no
   * substring operator, and a range query over the lowercased `email` field is
   * the closest thing that stays a single indexed query. The UI labels the box
   * accordingly rather than silently returning nothing for a mid-string match.
   */
  async listUsers({ search, role, status, limit, startAfter } = {}) {
    let query = db.collection('users');

    const term = String(search || '').trim().toLowerCase();

    if (term) {
      // Prefix range.  sorts after any ordinary character (it is the
      // high sentinel U+F8FF), so this matches every email beginning with `term`.
      return this._searchUsersByEmailPrefix(term, limit);
    }

    if (role) {
      if (!Object.values(ROLES).includes(role)) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INVALID_ROLE);
      }
      query = query.where('role', '==', role);
    }

    if (status === 'active') query = query.where('isActive', '==', true);
    if (status === 'disabled') query = query.where('isActive', '==', false);

    const snap = await this._run(
      this._paginate(query, { limit, startAfter }),
      'users list'
    );

    return this._page(snap.docs, limit, (d) => this._mapUser(d));
  }

  /**
   * Email-prefix search.
   *
   * Ordered by email rather than createdAt — a range filter and an orderBy must
   * agree on their field in Firestore. Search results are therefore not
   * paginated by cursor; the result set is capped instead, which is the right
   * shape for "find this person" as opposed to "browse everyone".
   */
  async _searchUsersByEmailPrefix(term, limit) {
    const snap = await this._run(
      db
        .collection('users')
        .where('email', '>=', term)
        .where('email', '<', `${term}`)
        .orderBy('email')
        .limit(this._limit(limit)),
      'user search'
    );

    return { items: snap.docs.map((d) => this._mapUser(d)), nextCursor: null };
  }

  /** One user, with everything they have done on the platform. */
  async getUser(uid) {
    const doc = await db.collection('users').doc(uid).get();

    if (!doc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const [purchases, withdrawals, commissions, directReferrals] = await Promise.all([
      this._run(
        db.collection('purchases').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(20),
        'user purchases'
      ),
      this._run(
        db.collection('withdrawals').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(20),
        'user withdrawals'
      ),
      this._run(
        db.collection('commissions').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(20),
        'user commissions'
      ),
      this._count(db.collection('users').where('referredBy', '==', uid), 'direct referrals'),
    ]);

    return {
      user: this._mapUser(doc),
      directReferrals,
      purchases: purchases.docs.map((d) => this._mapPurchase(d)),
      withdrawals: withdrawals.docs.map((d) => this._mapWithdrawal(d)),
      commissions: commissions.docs.map((d) => {
        const c = d.data();
        return {
          id: d.id,
          amount: Number(c.amount || 0),
          currency: c.currency || SHARES.CURRENCY,
          level: c.level ?? null,
          fromUid: c.fromUid || null,
          createdAt: this._iso(c.createdAt),
        };
      }),
    };
  }

  /**
   * Enable or disable an account.
   *
   * Three writes, and all three matter. The Firestore flag is what
   * `authenticate` checks; `auth.updateUser({ disabled })` stops Firebase from
   * minting new tokens; `revokeRefreshTokens` kills sessions that are already
   * live. Without the revoke, a disabled admin keeps working until their current
   * ID token expires, which is the window that matters when you are disabling
   * someone for cause.
   */
  async setUserActive(uid, isActive, actor) {
    if (uid === actor.uid) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.CANNOT_MODIFY_SELF);
    }

    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const target = doc.data();

    // Only a peer can disable a super admin — otherwise any admin could lock the
    // owner out of their own platform.
    if (
      target.role === ROLES.SUPER_ADMIN &&
      actor.role !== ROLES.SUPER_ADMIN
    ) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, MESSAGES.CANNOT_MODIFY_SUPER_ADMIN);
    }

    await ref.update({ isActive, updatedAt: FieldValue.serverTimestamp() });

    try {
      await auth.updateUser(uid, { disabled: !isActive });
      if (!isActive) await auth.revokeRefreshTokens(uid);
    } catch (error) {
      // Firestore is the source of truth for `authenticate`, so the account is
      // already blocked. Surface the partial failure rather than reporting a
      // clean success.
      logger.error(`Firebase Auth update failed for ${uid}: ${error.message}`);
      throw new ApiError(
        HTTP_STATUS.BAD_GATEWAY,
        'Account flag updated, but the auth provider rejected the change. Re-run to retry.'
      );
    }

    await this.logAction(actor.uid, isActive ? 'user.enable' : 'user.disable', uid, {
      email: target.email,
    });

    logger.info(`User ${uid} ${isActive ? 'enabled' : 'disabled'} by ${actor.uid}`);

    return { uid, isActive };
  }

  /**
   * Change a user's role. Super admin only (enforced at the route as well).
   *
   * Writes the Firestore field AND the custom claim because both exist today:
   * `authenticate` reads the document, but the claim is set at signup and would
   * otherwise drift out of step with it.
   */
  async setUserRole(uid, role, actor) {
    if (!Object.values(ROLES).includes(role)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INVALID_ROLE);
    }

    if (uid === actor.uid) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.CANNOT_MODIFY_SELF);
    }

    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const target = doc.data();

    if (target.role === role) {
      return { uid, role };
    }

    // Demoting the last super admin would leave nobody able to promote anyone.
    if (target.role === ROLES.SUPER_ADMIN && role !== ROLES.SUPER_ADMIN) {
      const remaining = await this._count(
        db.collection('users').where('role', '==', ROLES.SUPER_ADMIN),
        'super admins'
      );

      if (remaining !== null && remaining <= 1) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.LAST_SUPER_ADMIN);
      }
    }

    await ref.update({ role, updatedAt: FieldValue.serverTimestamp() });

    try {
      await auth.setCustomUserClaims(uid, { role });
      // Force a token refresh so the new role takes effect on the next request
      // instead of whenever the current token happens to expire.
      await auth.revokeRefreshTokens(uid);
    } catch (error) {
      logger.error(`Claim update failed for ${uid}: ${error.message}`);
      throw new ApiError(
        HTTP_STATUS.BAD_GATEWAY,
        'Role updated, but the auth provider rejected the claim change. Re-run to retry.'
      );
    }

    await this.logAction(actor.uid, 'user.role', uid, {
      email: target.email,
      from: target.role,
      to: role,
    });

    logger.info(`Role for ${uid} changed ${target.role} → ${role} by ${actor.uid}`);

    return { uid, role };
  }

  // ==================== payments / investments ====================

  _mapPayment(doc) {
    const d = doc.data();
    return {
      id: doc.id,
      uid: d.uid || null,
      email: d.email || null,
      reference: d.reference || null,
      quantity: Number(d.quantity || 0),
      // The USD ledger figure. `amount` is its alias on older documents.
      amountUsd: Number(d.amountUsd ?? d.amount ?? 0),
      currency: SHARES.CURRENCY,
      // The pinned quote: what the gateway was actually asked to collect. Kept
      // separate from amountUsd so an FX move cannot be mistaken for a
      // discrepancy in the ledger.
      chargeAmount: d.chargeAmount ?? null,
      chargeCurrency: d.chargeCurrency ?? null,
      fxRate: d.fxRate ?? null,
      fxSource: d.fxSource ?? null,
      gateway: d.gateway || null,
      status: d.status || null,
      createdAt: this._iso(d.createdAt),
      completedAt: this._iso(d.completedAt),
    };
  }

  _mapPurchase(doc) {
    const d = doc.data();
    return {
      id: d.id || doc.id,
      uid: d.uid || null,
      quantity: Number(d.quantity || 0),
      amountPaid: Number(d.amountPaid || 0),
      pricePerShare: Number(d.pricePerShare || 0),
      currency: SHARES.CURRENCY,
      gateway: d.gateway || null,
      paymentId: d.paymentId || null,
      status: d.status || null,
      createdAt: this._iso(d.createdAt),
    };
  }

  async listPayments({ status, gateway, limit, startAfter } = {}) {
    let query = db.collection('payments');

    if (status) {
      if (!Object.values(PAYMENT_STATUS).includes(status)) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Unknown payment status');
      }
      query = query.where('status', '==', status);
    }

    if (gateway) {
      if (!Object.values(PAYMENT_GATEWAYS).includes(gateway)) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INVALID_GATEWAY);
      }
      query = query.where('gateway', '==', gateway);
    }

    const snap = await this._run(
      this._paginate(query, { limit, startAfter }),
      'payments list'
    );

    return this._page(snap.docs, limit, (d) => this._mapPayment(d));
  }

  /** Completed purchases — the share ledger, as opposed to payment attempts. */
  async listPurchases({ limit, startAfter } = {}) {
    const snap = await this._run(
      this._paginate(db.collection('purchases'), { limit, startAfter }),
      'purchases list'
    );

    return this._page(snap.docs, limit, (d) => this._mapPurchase(d));
  }

  // ==================== withdrawals ====================

  _mapWithdrawal(doc) {
    const d = doc.data();
    const bank = d.bankDetails || {};
    return {
      id: d.id || doc.id,
      uid: d.uid || null,
      amount: Number(d.amount || 0),
      fee: Number(d.fee || 0),
      netAmount: Number(d.netAmount ?? d.amount ?? 0),
      currency: d.currency || WITHDRAWAL.CURRENCY,
      status: d.status || null,
      bank: {
        accountName: bank.accountName || null,
        accountNumber: bank.accountNumber || null,
        bankName: bank.bankName || null,
        bankCode: bank.bankCode || null,
      },
      note: d.note || null,
      processedBy: d.processedBy || null,
      processedAt: this._iso(d.processedAt),
      createdAt: this._iso(d.createdAt),
    };
  }

  /**
   * Withdrawal queue.
   *
   * Distinct from withdrawalService.listPending(), which is capped at 100
   * pending requests with no filtering — this backs a paginated view over every
   * status. Approval itself is NOT here: that stays in
   * withdrawalService.processWithdrawal(), which owns the hold/refund
   * transaction.
   */
  async listWithdrawals({ status, limit, startAfter } = {}) {
    let query = db.collection('withdrawals');

    if (status) {
      if (!Object.values(WITHDRAWAL_STATUS).includes(status)) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Unknown withdrawal status');
      }
      query = query.where('status', '==', status);
    }

    const snap = await this._run(
      this._paginate(query, { limit, startAfter }),
      'withdrawals list'
    );

    const page = this._page(snap.docs, limit, (d) => this._mapWithdrawal(d));

    // Attach who each request belongs to. Bounded by the page size, and only
    // for the uids actually on this page.
    const uids = [...new Set(page.items.map((w) => w.uid).filter(Boolean))];

    if (uids.length) {
      const users = await Promise.all(
        uids.map((uid) => db.collection('users').doc(uid).get())
      );
      const byUid = new Map(
        users.filter((u) => u.exists).map((u) => [u.id, u.data()])
      );

      page.items = page.items.map((w) => ({
        ...w,
        user: byUid.has(w.uid)
          ? {
              fullName: byUid.get(w.uid).fullName || null,
              email: byUid.get(w.uid).email || null,
              balance: Number(byUid.get(w.uid).balance || 0),
            }
          : null,
      }));
    }

    return page;
  }

  // ==================== settings ====================

  /**
   * Read-only platform configuration.
   *
   * Read-only on purpose. `shareService.getPriceUsd()` treats the
   * SHARE_PRICE_USD env var as authoritative and writes it through to
   * config/shares on every call, so a price written here from the UI would be
   * silently reverted on the next quote. Repricing is an env change plus a
   * redeploy, and this page says so instead of offering a control that does not
   * hold.
   *
   * Gateways report only whether they are configured. Returning key material to
   * a browser would be a far worse problem than the convenience is worth.
   */
  async getSettings() {
    const shares = await shareService.getShareInfo();

    let fx = null;
    try {
      const rate = await fxService.getUsdToNgnRate();
      fx = {
        usdToNgn: rate.rate,
        source: rate.source,
        fetchedAt: rate.fetchedAt ? new Date(rate.fetchedAt).toISOString() : null,
      };
    } catch (error) {
      // A hard 503 from fx is the designed behaviour when no rate can be
      // justified. Surface it as state rather than failing the whole page.
      fx = { usdToNgn: null, source: 'unavailable', error: error.message };
    }

    return {
      shares: {
        ...shares,
        priceSource: 'env:SHARE_PRICE_USD',
        maxPerOrder: SHARES.MAX_PER_ORDER,
      },
      withdrawal: {
        minUsd: WITHDRAWAL.MIN_USD,
        feePercent: WITHDRAWAL.FEE_PERCENT,
        currency: WITHDRAWAL.CURRENCY,
      },
      fx,
      gateways: {
        paystack: { configured: Boolean(process.env.PAYSTACK_SECRET_KEY) },
        stripe: {
          configured: Boolean(process.env.STRIPE_SECRET_KEY),
          publishableKeySet: Boolean(process.env.STRIPE_PUBLISHABLE_KEY),
          webhookSecretSet: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        },
        paypal: {
          configured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
          mode: process.env.PAYPAL_MODE || 'sandbox',
          webhookIdSet: Boolean(process.env.PAYPAL_WEBHOOK_ID),
        },
      },
      referral: {
        level1Percent: Number(process.env.REFERRAL_LEVEL1_RATE) || 15,
        level2Percent: Number(process.env.REFERRAL_LEVEL2_RATE) || 5,
      },
      environment: process.env.NODE_ENV || 'development',
    };
  }

  // ==================== audit ====================

  /**
   * Append-only record of privileged actions.
   *
   * Never allowed to break the action it describes: an admin disabling a
   * fraudulent account should not be blocked because the log write failed, so
   * this logs its own failure and returns.
   */
  async logAction(actorUid, action, targetUid = null, meta = {}) {
    try {
      await db.collection('adminActions').add({
        actorUid,
        action,
        targetUid,
        meta,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.error(`Audit write failed for ${action} by ${actorUid}: ${error.message}`);
    }
  }

  async listActions({ limit, startAfter } = {}) {
    const snap = await this._run(
      this._paginate(db.collection('adminActions'), { limit, startAfter }),
      'audit log'
    );

    return this._page(snap.docs, limit, (doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        actorUid: d.actorUid || null,
        action: d.action || null,
        targetUid: d.targetUid || null,
        meta: d.meta || {},
        createdAt: this._iso(d.createdAt),
      };
    });
  }
}

module.exports = new AdminService();
