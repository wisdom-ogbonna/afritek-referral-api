const axios = require('axios');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const {
  HTTP_STATUS,
  MESSAGES,
  SHARES,
  PAYMENT_GATEWAYS,
  PAYMENT_STATUS,
} = require('../utils/constants');
const shareService = require('./share.service');
const referralService = require('./referral.service');
const { logger } = require('../utils/logger');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PAYSTACK_BASE = 'https://api.paystack.co';

class PaymentService {
  /**
   * Initiate a share purchase payment.
   *
   * Creates a pending `payments` doc and hands back whatever the gateway needs
   * the client to act on (a redirect URL, or a Stripe client secret).
   */
  async initiatePurchase(uid, email, fullName, quantity, gateway) {
    if (!Object.values(PAYMENT_GATEWAYS).includes(gateway)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INVALID_GATEWAY);
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Quantity must be a positive integer');
    }

    // Check remaining shares
    const info = await shareService.getShareInfo();
    if (info.remainingShares < quantity) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        `${MESSAGES.INSUFFICIENT_SHARES}. Only ${info.remainingShares} left`
      );
    }

    const amount = quantity * SHARES.PRICE; // in Naira (kobo for Paystack)
    const reference = `SHR_${uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase()}`;

    // Create pending payment record
    const paymentRef = db.collection('payments').doc();
    await paymentRef.set({
      id: paymentRef.id,
      uid,
      email,
      fullName,
      quantity,
      amount,
      currency: SHARES.CURRENCY,
      gateway,
      reference,
      status: PAYMENT_STATUS.PENDING,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    let paymentData;

    switch (gateway) {
      case PAYMENT_GATEWAYS.PAYSTACK:
        paymentData = await this._initPaystack(email, amount, reference, paymentRef.id, quantity);
        break;
      case PAYMENT_GATEWAYS.STRIPE:
        paymentData = await this._initStripe(email, amount, reference, paymentRef.id, quantity);
        break;
      case PAYMENT_GATEWAYS.PAYPAL:
        paymentData = await this._initPaypal(email, amount, reference, paymentRef.id, quantity);
        break;
      default:
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INVALID_GATEWAY);
    }

    // Store gateway-specific data. gatewayOrderId/gatewayIntentId are persisted so
    // verification never depends on the client echoing them back.
    await paymentRef.update({
      gatewayData: paymentData.raw || {},
      gatewayOrderId: paymentData.orderId || null,
      gatewayIntentId: paymentData.intentId || null,
      authorizationUrl: paymentData.authorizationUrl || null,
      clientSecret: paymentData.clientSecret || null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info(`Payment initiated: ${reference} via ${gateway} for ${quantity} shares`);

    return {
      paymentId: paymentRef.id,
      reference,
      amount,
      currency: SHARES.CURRENCY,
      quantity,
      gateway,
      status: PAYMENT_STATUS.PENDING,
      authorizationUrl: paymentData.authorizationUrl || null,
      clientSecret: paymentData.clientSecret || null,
      publicKey: paymentData.publicKey || null,
      orderId: paymentData.orderId || null,
    };
  }

  /**
   * Verify a payment with its gateway and, on success, credit the shares.
   *
   * This is the client-facing half of POST /shares/buy. Webhooks reach the same
   * fulfilment through completePayment(), and both are safe to run concurrently.
   */
  async verifyPurchase(uid, reference, orderId = null) {
    const paymentDoc = await this._findPaymentByReference(reference);
    const payment = paymentDoc.data();

    // A reference is a bearer-ish token; make sure it is this caller's payment.
    if (payment.uid !== uid) {
      logger.warn(`Ownership mismatch verifying ${reference}: ${uid} != ${payment.uid}`);
      throw new ApiError(HTTP_STATUS.FORBIDDEN, MESSAGES.PAYMENT_FORBIDDEN);
    }

    if (payment.status === PAYMENT_STATUS.COMPLETED) {
      return this._buildVerifyResult(payment, paymentDoc.id, {
        alreadyProcessed: true,
        commissions: [],
      });
    }

    let outcome;

    switch (payment.gateway) {
      case PAYMENT_GATEWAYS.PAYSTACK:
        outcome = await this._verifyPaystack(payment);
        break;
      case PAYMENT_GATEWAYS.STRIPE:
        outcome = await this._verifyStripe(payment);
        break;
      case PAYMENT_GATEWAYS.PAYPAL:
        outcome = await this._verifyPaypal(payment, orderId);
        break;
      default:
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INVALID_GATEWAY);
    }

    if (!outcome.paid) {
      // Record the terminal states; leave anything still in flight as pending.
      if (
        outcome.status === PAYMENT_STATUS.FAILED ||
        outcome.status === PAYMENT_STATUS.CANCELLED
      ) {
        await paymentDoc.ref.update({
          status: outcome.status,
          failureReason: outcome.reason || 'Gateway reported the payment was not successful',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        `${MESSAGES.PAYMENT_NOT_COMPLETED}${outcome.reason ? `: ${outcome.reason}` : ''}`,
        [{ field: 'reference', message: `Gateway status: ${outcome.gatewayStatus || 'unknown'}` }]
      );
    }

    const completion = await this.completePayment(reference, outcome.payload);

    const freshSnap = await paymentDoc.ref.get();

    return this._buildVerifyResult(freshSnap.data(), paymentDoc.id, {
      alreadyProcessed: Boolean(completion.alreadyProcessed),
      commissions: completion.commissions || [],
    });
  }

  /**
   * Shape the verify response, including the user's resulting holdings.
   */
  async _buildVerifyResult(payment, paymentId, { alreadyProcessed, commissions }) {
    const userSnap = await db.collection('users').doc(payment.uid).get();
    const user = userSnap.exists ? userSnap.data() : {};

    return {
      paymentId,
      reference: payment.reference,
      status: payment.status,
      quantity: payment.quantity,
      amount: payment.amount,
      currency: payment.currency,
      gateway: payment.gateway,
      alreadyProcessed,
      shares: {
        sharesOwned: user.sharesOwned || 0,
        totalInvested: user.totalInvested || 0,
      },
      commissions,
    };
  }

  async _findPaymentByReference(reference) {
    const paymentsSnap = await db
      .collection('payments')
      .where('reference', '==', reference)
      .limit(1)
      .get();

    if (paymentsSnap.empty) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, MESSAGES.PAYMENT_NOT_FOUND);
    }

    return paymentsSnap.docs[0];
  }

  /**
   * Run an outbound gateway call, converting transport and upstream-auth
   * failures into a deliberate 502.
   *
   * Without this, errorHandler forwards `err.status`/`err.statusCode` from the
   * raw axios/Stripe error (errorHandler.js:20-23), so a misconfigured gateway
   * key reaches the client as a 401 — indistinguishable from an expired session,
   * which would make the frontend log a perfectly valid user out.
   */
  async _gatewayCall(gateway, operation, fn) {
    try {
      return await fn();
    } catch (err) {
      // Deliberate, already-classified failures pass through untouched.
      if (err instanceof ApiError) throw err;

      const upstreamStatus = err.response?.status || err.statusCode || err.status || null;
      const upstreamDetail =
        err.response?.data?.message ||
        err.response?.data?.error_description ||
        err.response?.data?.details?.[0]?.description ||
        err.message;

      logger.error(
        `${gateway} ${operation} failed${
          upstreamStatus ? ` (upstream ${upstreamStatus})` : ''
        }: ${upstreamDetail}`
      );

      throw new ApiError(
        HTTP_STATUS.BAD_GATEWAY,
        `${gateway} ${operation} failed. Please try again or contact support.`,
        [
          {
            field: 'gateway',
            message: `${gateway} returned ${upstreamStatus || 'a transport error'}`,
          },
        ]
      );
    }
  }

  /**
   * Paystack initialize
   */
  async _initPaystack(email, amountNaira, reference, paymentId, quantity) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Paystack not configured');

    const response = await this._gatewayCall('Paystack', 'initialization', () =>
      axios.post(
        `${PAYSTACK_BASE}/transaction/initialize`,
        {
          email,
          amount: amountNaira * 100, // kobo
          reference,
          currency: 'NGN',
          callback_url: `${process.env.FRONTEND_URL}/payment/callback?gateway=paystack`,
          metadata: {
            paymentId,
            quantity,
            custom_fields: [
              { display_name: 'Shares', variable_name: 'shares', value: quantity },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
        }
      )
    );

    if (!response.data.status) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, response.data.message || 'Paystack init failed');
    }

    return {
      authorizationUrl: response.data.data.authorization_url,
      accessCode: response.data.data.access_code,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY,
      raw: response.data.data,
    };
  }

  /**
   * Paystack verify — the transaction status is authoritative, not the redirect.
   */
  async _verifyPaystack(payment) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Paystack not configured');

    const response = await this._gatewayCall('Paystack', 'verification', () =>
      axios.get(
        `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(payment.reference)}`,
        { headers: { Authorization: `Bearer ${secret}` } }
      )
    );

    const data = response.data?.data || {};

    if (data.status === 'success') {
      this._assertPaystackAmount(payment, data);
      return { paid: true, payload: data, gatewayStatus: data.status };
    }

    // Paystack statuses: success | failed | reversed | abandoned | ongoing |
    // pending | queued. Only failed/reversed are terminal — "abandoned" is just
    // the resting state of a transaction nobody has paid yet, and the same
    // checkout link stays payable, so it must not be recorded as cancelled.
    const terminal = {
      failed: PAYMENT_STATUS.FAILED,
      reversed: PAYMENT_STATUS.FAILED,
    };

    return {
      paid: false,
      gatewayStatus: data.status,
      status: terminal[data.status] || PAYMENT_STATUS.PENDING,
      reason: data.gateway_response || null,
      payload: data,
    };
  }

  /**
   * A successful Paystack transaction must also have collected the full amount
   * for this payment. Paystack reports kobo; we store Naira.
   *
   * Without this, a transaction marked successful for less than the order value
   * would still credit the full share quantity.
   */
  _assertPaystackAmount(payment, data) {
    const expectedKobo = Math.round(payment.amount * 100);
    const paidKobo = Number(data.amount);

    if (!Number.isFinite(paidKobo) || paidKobo < expectedKobo) {
      logger.error(
        `Paystack amount mismatch on ${payment.reference}: paid ${paidKobo} kobo, expected ${expectedKobo}`
      );
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        'Amount paid does not match the order total. Please contact support.',
        [{ field: 'amount', message: `Expected ₦${payment.amount}` }]
      );
    }

    const paidCurrency = (data.currency || SHARES.CURRENCY).toUpperCase();
    if (paidCurrency !== SHARES.CURRENCY.toUpperCase()) {
      logger.error(
        `Paystack currency mismatch on ${payment.reference}: ${paidCurrency} != ${SHARES.CURRENCY}`
      );
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Payment currency does not match the order');
    }
  }

  /**
   * Stripe PaymentIntent (amount converted roughly; for real use convert NGN→USD)
   */
  async _initStripe(email, amountNaira, reference, paymentId, quantity) {
    if (!stripe) throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Stripe not configured');

    // FX rate is configuration, not a literal buried in two different methods —
    // a stale hardcoded rate silently under- or over-charges every card payer.
    const amountUsdCents = Math.round((amountNaira / this._ngnPerUsd()) * 100);

    const paymentIntent = await this._gatewayCall('Stripe', 'payment intent creation', () =>
      stripe.paymentIntents.create({
        amount: amountUsdCents,
        currency: process.env.STRIPE_CURRENCY || 'usd',
        receipt_email: email,
        metadata: {
          reference,
          paymentId,
          quantity: String(quantity),
          originalAmountNGN: String(amountNaira),
        },
        automatic_payment_methods: { enabled: true },
      })
    );

    return {
      clientSecret: paymentIntent.client_secret,
      publicKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      intentId: paymentIntent.id,
      raw: { id: paymentIntent.id },
    };
  }

  /**
   * Stripe verify — re-read the PaymentIntent server-side.
   */
  async _verifyStripe(payment) {
    if (!stripe) throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Stripe not configured');

    const intentId = payment.gatewayIntentId || payment.gatewayData?.id;
    if (!intentId) {
      throw new ApiError(
        HTTP_STATUS.INTERNAL_SERVER,
        'Stripe payment intent id missing on this payment'
      );
    }

    const intent = await this._gatewayCall('Stripe', 'verification', () =>
      stripe.paymentIntents.retrieve(intentId)
    );

    if (intent.status === 'succeeded') {
      return { paid: true, payload: intent, gatewayStatus: intent.status };
    }

    return {
      paid: false,
      gatewayStatus: intent.status,
      status: intent.status === 'canceled' ? PAYMENT_STATUS.CANCELLED : PAYMENT_STATUS.PENDING,
      reason: intent.last_payment_error?.message || null,
      payload: intent,
    };
  }

  /**
   * PayPal order
   */
  async _initPaypal(email, amountNaira, reference, paymentId, quantity) {
    const accessToken = await this._getPaypalAccessToken();

    // Convert to USD for PayPal
    const amountUsd = (amountNaira / this._ngnPerUsd()).toFixed(2);

    const response = await this._gatewayCall('PayPal', 'order creation', () =>
      axios.post(
        `${this._paypalBase()}/v2/checkout/orders`,
        {
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: reference,
              description: `${quantity} Share(s)`,
              amount: {
                currency_code: 'USD',
                value: amountUsd,
              },
              custom_id: paymentId,
            },
          ],
          application_context: {
            brand_name: 'Share Investment',
            landing_page: 'BILLING',
            user_action: 'PAY_NOW',
            return_url: `${process.env.FRONTEND_URL}/payment/callback?gateway=paypal`,
            cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )
    );

    const approveLink = (response.data.links || []).find((l) => l.rel === 'approve');

    return {
      authorizationUrl: approveLink ? approveLink.href : null,
      orderId: response.data.id,
      raw: response.data,
    };
  }

  /**
   * PayPal verify — an APPROVED order still has to be captured before the money
   * actually moves, so capture here rather than treating approval as payment.
   */
  async _verifyPaypal(payment, orderIdFromClient = null) {
    const orderId = payment.gatewayOrderId || orderIdFromClient || payment.gatewayData?.id;
    if (!orderId) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'PayPal order id missing for this payment');
    }

    let order = await this._getPaypalOrder(orderId);

    if (order.status === 'APPROVED') {
      order = await this._capturePaypalOrder(orderId);
    }

    if (order.status === 'COMPLETED') {
      return { paid: true, payload: order, gatewayStatus: order.status };
    }

    return {
      paid: false,
      gatewayStatus: order.status,
      status: order.status === 'VOIDED' ? PAYMENT_STATUS.CANCELLED : PAYMENT_STATUS.PENDING,
      reason: `PayPal order status is ${order.status}`,
      payload: order,
    };
  }

  async _getPaypalOrder(orderId) {
    const accessToken = await this._getPaypalAccessToken();

    const response = await this._gatewayCall('PayPal', 'order lookup', () =>
      axios.get(
        `${this._paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
    );

    return response.data;
  }

  /**
   * Capture an approved PayPal order. A replay (webhook + client verify racing)
   * gets ORDER_ALREADY_CAPTURED back, which is a success, not an error.
   */
  async _capturePaypalOrder(orderId) {
    const accessToken = await this._getPaypalAccessToken();

    try {
      const response = await axios.post(
        `${this._paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info(`PayPal order captured: ${orderId} → ${response.data.status}`);
      return response.data;
    } catch (err) {
      const issue = err.response?.data?.details?.[0]?.issue;

      if (issue === 'ORDER_ALREADY_CAPTURED') {
        logger.info(`PayPal order ${orderId} was already captured; re-reading order`);
        return this._getPaypalOrder(orderId);
      }

      // A named PayPal issue is a real, client-actionable problem (declined
      // funding source, order already voided) — surface it as a 400. Anything
      // else is an upstream/transport failure and belongs in _gatewayCall's 502.
      if (issue) {
        logger.error(`PayPal capture failed for ${orderId}: ${issue}`);
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, `PayPal capture failed: ${issue}`);
      }

      return this._gatewayCall('PayPal', 'capture', () => {
        throw err;
      });
    }
  }

  _paypalBase() {
    return process.env.PAYPAL_MODE === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  /**
   * NGN per 1 USD, used for the card gateways that cannot charge in Naira.
   */
  _ngnPerUsd() {
    const rate = parseFloat(process.env.NGN_PER_USD);
    return Number.isFinite(rate) && rate > 0 ? rate : 1600;
  }

  async _getPaypalAccessToken() {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'PayPal not configured');
    }

    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString('base64');

    const response = await this._gatewayCall('PayPal', 'authentication', () =>
      axios.post(
        `${this._paypalBase()}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      )
    );

    return response.data.access_token;
  }

  /**
   * Complete a payment: reserve inventory, credit shares, record the purchase,
   * mark the payment, then distribute referral commissions.
   *
   * Idempotent and safe to call concurrently from the client verify path and a
   * gateway webhook — only the caller that actually performs the fulfilment
   * writes goes on to pay commissions.
   */
  async completePayment(reference, gatewayPayload = {}) {
    const paymentDoc = await this._findPaymentByReference(reference);
    const payment = paymentDoc.data();

    if (payment.status === PAYMENT_STATUS.COMPLETED) {
      return { alreadyProcessed: true, paymentId: paymentDoc.id, payment, commissions: [] };
    }

    let didFulfil = false;

    // Atomic completion - ALL READS FIRST, then ALL WRITES
    await db.runTransaction(async (tx) => {
      // Firestore retries this callback on contention, so reset the flag here
      // rather than relying on its value from an aborted attempt.
      didFulfil = false;

      // ========== ALL READS FIRST ==========
      const freshSnap = await tx.get(paymentDoc.ref);
      const freshData = freshSnap.data();
      if (freshData.status === PAYMENT_STATUS.COMPLETED) {
        // Someone else won the race; leave didFulfil false so we skip commissions.
        return;
      }

      const sharesRef = db.collection('config').doc('shares');
      const sharesSnap = await tx.get(sharesRef);
      if (!sharesSnap.exists) {
        throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Shares config missing');
      }
      const sharesData = sharesSnap.data();

      const userRef = db.collection('users').doc(payment.uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
      }

      // ========== ALL WRITES AFTER READS ==========
      if (sharesData.remainingShares < payment.quantity) {
        tx.update(paymentDoc.ref, {
          status: PAYMENT_STATUS.FAILED,
          failureReason: 'Insufficient shares at confirmation time',
          updatedAt: FieldValue.serverTimestamp(),
        });
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INSUFFICIENT_SHARES);
      }

      // Reserve shares
      tx.update(sharesRef, {
        remainingShares: FieldValue.increment(-payment.quantity),
        soldShares: FieldValue.increment(payment.quantity),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Credit shares to user
      tx.update(userRef, {
        sharesOwned: FieldValue.increment(payment.quantity),
        totalInvested: FieldValue.increment(payment.amount),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Record purchase
      const purchaseRef = db.collection('purchases').doc();
      tx.set(purchaseRef, {
        id: purchaseRef.id,
        uid: payment.uid,
        quantity: payment.quantity,
        amountPaid: payment.amount,
        pricePerShare: payment.amount / payment.quantity,
        paymentId: paymentDoc.id,
        gateway: payment.gateway,
        status: PAYMENT_STATUS.COMPLETED,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Mark payment success
      tx.update(paymentDoc.ref, {
        status: PAYMENT_STATUS.COMPLETED,
        gatewayPayload,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      didFulfil = true;
    });

    if (!didFulfil) {
      logger.info(`Payment ${reference} was already completed by another path`);
      const freshSnap = await paymentDoc.ref.get();
      return {
        alreadyProcessed: true,
        paymentId: paymentDoc.id,
        payment: freshSnap.data(),
        commissions: [],
      };
    }

    // Distribute referral commissions (outside the main tx, once per payment).
    // Commission writes are keyed on the payment id, so a retry cannot double-pay.
    let commissions = [];
    try {
      commissions = await referralService.distributeCommissions(
        payment.uid,
        payment.amount,
        paymentDoc.id
      );
      await paymentDoc.ref.update({
        commissionsStatus: 'distributed',
        commissionsDistributedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (commErr) {
      // Shares are already credited; flag this so it is replayable rather than lost.
      logger.error(`Commission distribution failed for ${reference}: ${commErr.message}`);
      await paymentDoc.ref
        .update({
          commissionsStatus: 'failed',
          commissionsError: commErr.message,
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch((flagErr) =>
          logger.error(`Could not flag commission failure for ${reference}: ${flagErr.message}`)
        );
    }

    logger.info(`Payment completed: ${reference} → ${payment.quantity} shares to ${payment.uid}`);

    return {
      success: true,
      alreadyProcessed: false,
      paymentId: paymentDoc.id,
      quantity: payment.quantity,
      commissions,
    };
  }

  /**
   * Webhook entry point for Paystack.
   *
   * Deliberately ignores the amounts in the webhook body and re-verifies the
   * reference against Paystack's API instead, so fulfilment never depends on a
   * payload an attacker might have crafted — signature check plus this makes
   * spoofing useless.
   */
  async completePaystackReference(reference) {
    const paymentDoc = await this._findPaymentByReference(reference);
    const payment = paymentDoc.data();

    if (payment.status === PAYMENT_STATUS.COMPLETED) {
      return { alreadyProcessed: true, paymentId: paymentDoc.id, commissions: [] };
    }

    const outcome = await this._verifyPaystack(payment);

    if (!outcome.paid) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        `Paystack reports ${outcome.gatewayStatus || 'an unpaid transaction'} for ${reference}`
      );
    }

    return this.completePayment(reference, outcome.payload);
  }

  /**
   * Webhook entry point for PayPal: capture the order first so an APPROVED-only
   * order never credits shares against money that was never taken.
   */
  async completePaypalOrder(orderId, reference) {
    let order = await this._getPaypalOrder(orderId);

    if (order.status === 'APPROVED') {
      order = await this._capturePaypalOrder(orderId);
    }

    if (order.status !== 'COMPLETED') {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        `PayPal order ${orderId} is ${order.status}, not COMPLETED`
      );
    }

    return this.completePayment(reference, order);
  }

  /**
   * Resolve a PayPal webhook to one of our payments and fulfil it.
   *
   * CHECKOUT.ORDER.APPROVED carries our reference in purchase_units[].reference_id,
   * but PAYMENT.CAPTURE.COMPLETED does not — it only carries the PayPal order id
   * under supplementary_data. Looking that up by `gatewayOrderId` is why
   * initiatePurchase persists it.
   */
  async completePaypalWebhook({ orderId = null, reference = null }) {
    let paymentDoc = null;

    if (reference && /^SHR_[A-Z0-9]{16}$/.test(reference)) {
      paymentDoc = await this._findPaymentByReference(reference);
    } else if (orderId) {
      paymentDoc = await this._findPaymentByOrderId(orderId);
    }

    if (!paymentDoc) {
      throw new ApiError(
        HTTP_STATUS.NOT_FOUND,
        `No payment matches PayPal order ${orderId || '(none)'} / reference ${reference || '(none)'}`
      );
    }

    const payment = paymentDoc.data();
    const resolvedOrderId = payment.gatewayOrderId || orderId;

    if (!resolvedOrderId) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        `PayPal order id missing for payment ${payment.reference}`
      );
    }

    return this.completePaypalOrder(resolvedOrderId, payment.reference);
  }

  async _findPaymentByOrderId(orderId) {
    const snap = await db
      .collection('payments')
      .where('gatewayOrderId', '==', orderId)
      .limit(1)
      .get();

    return snap.empty ? null : snap.docs[0];
  }

  /**
   * Verify a PayPal webhook against PayPal's own signature-verification API.
   *
   * Without this the /webhooks/paypal endpoint credits shares to anyone who can
   * POST a PAYMENT.CAPTURE.COMPLETED body at it.
   *
   * @returns {Promise<boolean>} true only when PayPal answers SUCCESS
   */
  async verifyPaypalWebhook(headers, rawBody) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;

    if (!webhookId) {
      logger.error('PAYPAL_WEBHOOK_ID is not set; refusing to trust PayPal webhooks');
      return false;
    }

    const required = [
      'paypal-transmission-id',
      'paypal-transmission-time',
      'paypal-transmission-sig',
      'paypal-cert-url',
      'paypal-auth-algo',
    ];

    if (required.some((h) => !headers[h])) {
      logger.warn('PayPal webhook is missing signature headers');
      return false;
    }

    const accessToken = await this._getPaypalAccessToken();

    // The event must be sent back as the parsed object, but parsed from the exact
    // bytes PayPal signed — never from a re-serialised copy.
    const response = await this._gatewayCall('PayPal', 'webhook verification', () =>
      axios.post(
        `${this._paypalBase()}/v1/notifications/verify-webhook-signature`,
        {
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: JSON.parse(rawBody.toString('utf8')),
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )
    );

    return response.data?.verification_status === 'SUCCESS';
  }
}

module.exports = new PaymentService();
