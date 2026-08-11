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

class PaymentService {
  /**
   * Initiate a share purchase payment
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

    // Store gateway-specific data
    await paymentRef.update({
      gatewayData: paymentData.raw || {},
      authorizationUrl: paymentData.authorizationUrl || null,
      clientSecret: paymentData.clientSecret || null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info(`Payment initiated: ${reference} via ${gateway} for ${quantity} shares`);

    return {
      paymentId: paymentRef.id,
      reference,
      amount,
      quantity,
      gateway,
      authorizationUrl: paymentData.authorizationUrl || null,
      clientSecret: paymentData.clientSecret || null,
      publicKey: paymentData.publicKey || null,
      message: MESSAGES.PAYMENT_INITIATED,
    };
  }

  /**
   * Paystack initialize
   */
  async _initPaystack(email, amountNaira, reference, paymentId, quantity) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Paystack not configured');

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
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
   * Stripe PaymentIntent (amount converted roughly; for real use convert NGN→USD)
   */
  async _initStripe(email, amountNaira, reference, paymentId, quantity) {
    if (!stripe) throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Stripe not configured');

    // Simple conversion example (you should use a real FX rate service)
    const amountUsdCents = Math.round((amountNaira / 1600) * 100); // approx

    const paymentIntent = await stripe.paymentIntents.create({
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
    });

    return {
      clientSecret: paymentIntent.client_secret,
      publicKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      raw: { id: paymentIntent.id },
    };
  }

  /**
   * PayPal order
   */
  async _initPaypal(email, amountNaira, reference, paymentId, quantity) {
    const accessToken = await this._getPaypalAccessToken();
    const base =
      process.env.PAYPAL_MODE === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    // Convert to USD for PayPal
    const amountUsd = (amountNaira / 1600).toFixed(2);

    const response = await axios.post(
      `${base}/v2/checkout/orders`,
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
    );

    const approveLink = response.data.links.find((l) => l.rel === 'approve');

    return {
      authorizationUrl: approveLink ? approveLink.href : null,
      orderId: response.data.id,
      raw: response.data,
    };
  }

  async _getPaypalAccessToken() {
    const base =
      process.env.PAYPAL_MODE === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString('base64');

    const response = await axios.post(
      `${base}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return response.data.access_token;
  }

  /**
   * Verify & complete payment (called from webhooks or manual verify)
   */
  async completePayment(reference, gatewayPayload = {}) {
    const paymentsSnap = await db
      .collection('payments')
      .where('reference', '==', reference)
      .limit(1)
      .get();

    if (paymentsSnap.empty) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Payment not found');
    }

    const paymentDoc = paymentsSnap.docs[0];
    const payment = paymentDoc.data();

    if (payment.status === 'completed') {
      return { alreadyProcessed: true, payment };
    }

    // Atomic completion - ALL READS FIRST, then ALL WRITES
    await db.runTransaction(async (tx) => {
      // ========== ALL READS FIRST ==========
      const freshSnap = await tx.get(paymentDoc.ref);
      const freshData = freshSnap.data();
      if (freshData.status === 'completed') {
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
          status: 'failed',
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
        status: 'completed',
        createdAt: FieldValue.serverTimestamp(),
      });

      // Mark payment success
      tx.update(paymentDoc.ref, {
        status: 'completed',
        gatewayPayload,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // Distribute referral commissions (outside the main tx)
    try {
      await referralService.distributeCommissions(
        payment.uid,
        payment.amount,
        paymentDoc.id
      );
    } catch (commErr) {
      logger.error(`Commission distribution failed for ${reference}: ${commErr.message}`);
    }

    logger.info(`Payment completed: ${reference} → ${payment.quantity} shares to ${payment.uid}`);

    return { success: true, paymentId: paymentDoc.id, quantity: payment.quantity };
  }

  /**
   * Verify Paystack transaction (can be called from frontend or webhook)
   */
  async verifyPaystack(reference) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );

    if (response.data.data.status === 'success') {
      return this.completePayment(reference, response.data.data);
    }

    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Payment not successful');
  }
}

module.exports = new PaymentService();
