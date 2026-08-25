const express = require('express');
const crypto = require('crypto');
const paymentService = require('../services/payment.service');
const { logger } = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * Every handler here takes the RAW body.
 *
 * Signatures are computed over the exact bytes the gateway sent, so parsing to
 * an object and re-serialising it (`JSON.stringify(req.body)`) can change key
 * order, number formatting or unicode escaping and break an otherwise valid
 * signature. Parse only after the signature has been checked.
 */
const rawJson = express.raw({ type: 'application/json' });

const parseRaw = (req) => {
  try {
    return JSON.parse(req.body.toString('utf8'));
  } catch {
    return null;
  }
};

/**
 * Paystack Webhook
 * Paystack Dashboard → Settings → API Keys & Webhooks
 * URL: https://yourdomain.com/api/v1/webhooks/paystack
 */
router.post(
  '/paystack',
  rawJson,
  asyncHandler(async (req, res) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!secret) {
      logger.error('Paystack webhook received but PAYSTACK_SECRET_KEY is not set');
      return res.sendStatus(500);
    }

    const signature = req.headers['x-paystack-signature'];
    const expected = crypto.createHmac('sha512', secret).update(req.body).digest('hex');

    // timingSafeEqual throws on a length mismatch, so guard before comparing.
    const signatureValid =
      typeof signature === 'string' &&
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    if (!signatureValid) {
      logger.warn('Invalid Paystack webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const event = parseRaw(req);

    if (!event) {
      logger.warn('Paystack webhook body was not valid JSON');
      return res.status(400).send('Invalid payload');
    }

    if (event.event === 'charge.success') {
      const reference = event.data?.reference;

      if (reference) {
        try {
          // Re-verifies against Paystack's API rather than trusting the payload.
          await paymentService.completePaystackReference(reference);
          logger.info(`Paystack webhook: payment ${reference} completed`);
        } catch (err) {
          logger.error(`Paystack webhook error for ${reference}: ${err.message}`);
        }
      }
    }

    // Always 200 on a signed event — a non-2xx makes Paystack retry, and the
    // failures above are ours to fix, not something a retry will resolve.
    res.sendStatus(200);
  })
);

/**
 * Stripe Webhook — constructEvent needs the raw body for its signature check.
 */
router.post(
  '/stripe',
  rawJson,
  asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const Stripe = require('stripe');

    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      logger.error('Stripe webhook received but Stripe is not configured');
      return res.sendStatus(500);
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn(`Stripe webhook signature error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const reference = intent.metadata?.reference;

      if (reference) {
        try {
          await paymentService.completePayment(reference, intent);
          logger.info(`Stripe webhook: payment ${reference} completed`);
        } catch (err) {
          logger.error(`Stripe webhook error for ${reference}: ${err.message}`);
        }
      }
    }

    res.json({ received: true });
  })
);

/**
 * PayPal Webhook.
 *
 * Verified against PayPal's verify-webhook-signature API — without that this
 * endpoint would credit shares to anyone able to POST a
 * PAYMENT.CAPTURE.COMPLETED body at it.
 *
 * CHECKOUT.ORDER.APPROVED only means the payer approved; the order still has to
 * be captured before money moves, which completePaypalWebhook handles.
 */
router.post(
  '/paypal',
  rawJson,
  asyncHandler(async (req, res) => {
    let verified = false;

    try {
      verified = await paymentService.verifyPaypalWebhook(req.headers, req.body);
    } catch (err) {
      logger.error(`PayPal webhook verification failed: ${err.message}`);
      return res.sendStatus(401);
    }

    if (!verified) {
      logger.warn('Rejected an unverified PayPal webhook');
      return res.sendStatus(401);
    }

    const event = parseRaw(req);

    if (!event) {
      logger.warn('PayPal webhook body was not valid JSON');
      return res.status(400).send('Invalid payload');
    }

    const handled = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED'];

    if (handled.includes(event.event_type)) {
      const resource = event.resource || {};

      // ORDER.APPROVED: resource IS the order, and carries our reference.
      // PAYMENT.CAPTURE.COMPLETED: resource is the capture — no reference, only
      // the order id under supplementary_data.
      const reference = resource.purchase_units?.[0]?.reference_id || null;
      const orderId =
        event.event_type === 'CHECKOUT.ORDER.APPROVED'
          ? resource.id
          : resource.supplementary_data?.related_ids?.order_id || null;

      try {
        const result = await paymentService.completePaypalWebhook({ orderId, reference });
        logger.info(
          `PayPal webhook ${event.event_type}: payment ${result.paymentId} ${
            result.alreadyProcessed ? 'already processed' : 'completed'
          }`
        );
      } catch (err) {
        logger.error(`PayPal webhook error (${event.event_type}): ${err.message}`);
      }
    }

    res.sendStatus(200);
  })
);

module.exports = router;
