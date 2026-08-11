const express = require('express');
const crypto = require('crypto');
const paymentService = require('../services/payment.service');
const { logger } = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * Paystack Webhook
 * Configure in Paystack Dashboard → Settings → Webhooks
 * URL: https://yourdomain.com/api/v1/webhooks/paystack
 */
router.post(
  '/paystack',
  express.json({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      logger.warn('Invalid Paystack webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      try {
        await paymentService.completePayment(reference, event.data);
        logger.info(`Paystack webhook: payment ${reference} completed`);
      } catch (err) {
        logger.error(`Paystack webhook error: ${err.message}`);
      }
    }

    res.sendStatus(200);
  })
);

/**
 * Stripe Webhook
 * Use raw body for signature verification
 */
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      logger.warn(`Stripe webhook signature error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const reference = intent.metadata.reference;
      if (reference) {
        try {
          await paymentService.completePayment(reference, intent);
          logger.info(`Stripe webhook: payment ${reference} completed`);
        } catch (err) {
          logger.error(`Stripe webhook error: ${err.message}`);
        }
      }
    }

    res.json({ received: true });
  })
);

/**
 * PayPal Webhook (simplified – verify in production with PayPal SDK)
 */
router.post(
  '/paypal',
  express.json(),
  asyncHandler(async (req, res) => {
    const event = req.body;

    if (event.event_type === 'CHECKOUT.ORDER.APPROVED' || event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource = event.resource;
      const reference =
        resource.purchase_units?.[0]?.reference_id ||
        resource.supplementary_data?.related_ids?.order_id;

      if (reference) {
        try {
          await paymentService.completePayment(reference, resource);
          logger.info(`PayPal webhook: payment ${reference} completed`);
        } catch (err) {
          logger.error(`PayPal webhook error: ${err.message}`);
        }
      }
    }

    res.sendStatus(200);
  })
);

module.exports = router;
