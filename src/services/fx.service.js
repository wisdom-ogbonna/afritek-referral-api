const axios = require('axios');
const { db, FieldValue } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');
const { logger } = require('../utils/logger');

const CACHE_REF = () => db.collection('config').doc('fxRate');

const DEFAULTS = {
  PROVIDER_URL: 'https://open.er-api.com/v6/latest/USD',
  TTL_HOURS: 12,
  MIN_RATE: 500,
  MAX_RATE: 10000,
  TIMEOUT_MS: 8000,
};

/**
 * USD → NGN rate resolution.
 *
 * This exists because the price of a share is denominated in USD ($20) but
 * Paystack can only bill Naira. The rate therefore decides real money, and it
 * must never come from — or be influenceable by — the client: nothing here
 * accepts an argument, and no caller passes one.
 *
 * It replaces a `parseFloat(process.env.NGN_PER_USD) || 1600` helper that used to
 * live on paymentService. That fallback was silent, and NGN_PER_USD was absent
 * from the deployed environment, so every card charge was priced off a literal
 * that nobody had reviewed in months. The rule here is the opposite: a rate we
 * cannot justify is a hard failure, never a guess.
 */
class FxService {
  /**
   * NGN per 1 USD, with provenance.
   *
   * Resolution order — cache, then live provider, then the configured fallback:
   *   1. `config/fxRate` if it was written inside FX_CACHE_TTL_HOURS
   *   2. a live fetch from FX_PROVIDER_URL, sanity-banded and cached
   *   3. NGN_PER_USD from the environment, also sanity-banded
   *   4. otherwise throw — Paystack purchases stop rather than mis-charge
   *
   * @returns {Promise<{rate: number, source: string, fetchedAt: Date}>}
   */
  async getUsdToNgnRate() {
    const cached = await this._readCache();
    if (cached) return cached;

    const live = await this._fetchLive();
    if (live) {
      await this._writeCache(live);
      return live;
    }

    return this._envFallback();
  }

  /**
   * The band that separates a plausible rate from a broken one.
   *
   * A provider that starts returning inverted rates (0.00074 USD per NGN) or a
   * placeholder `1` would otherwise silently make shares nearly free. Both ends
   * are deliberately loose — this rejects nonsense, it does not track the market.
   */
  _isPlausible(rate) {
    const min = parseFloat(process.env.FX_MIN_RATE) || DEFAULTS.MIN_RATE;
    const max = parseFloat(process.env.FX_MAX_RATE) || DEFAULTS.MAX_RATE;
    return Number.isFinite(rate) && rate > min && rate < max;
  }

  async _readCache() {
    const ttlHours = parseFloat(process.env.FX_CACHE_TTL_HOURS) || DEFAULTS.TTL_HOURS;

    let snap;
    try {
      snap = await CACHE_REF().get();
    } catch (err) {
      // A Firestore hiccup on the cache read must not block a purchase; fall
      // through to the live provider instead.
      logger.warn(`FX cache read failed, falling through to provider: ${err.message}`);
      return null;
    }

    if (!snap.exists) return null;

    const data = snap.data();
    const fetchedAtMs = data.fetchedAt?.toMillis?.();

    if (!fetchedAtMs || !this._isPlausible(data.rate)) return null;

    const ageHours = (Date.now() - fetchedAtMs) / 3600000;
    if (ageHours >= ttlHours) return null;

    return {
      rate: data.rate,
      source: 'cache',
      fetchedAt: new Date(fetchedAtMs),
    };
  }

  /**
   * Fetch from the configured provider. Returns null on any failure so the
   * caller can fall back — this must never throw past getUsdToNgnRate().
   *
   * The response shape assumed is exchangerate-api's open endpoint:
   * `{ result: 'success', base_code: 'USD', rates: { NGN: 1350.47, … } }`.
   */
  async _fetchLive() {
    const url = process.env.FX_PROVIDER_URL || DEFAULTS.PROVIDER_URL;

    try {
      const { data } = await axios.get(url, { timeout: DEFAULTS.TIMEOUT_MS });

      if (data?.result && data.result !== 'success') {
        logger.error(`FX provider reported failure: ${data.result} (${url})`);
        return null;
      }

      if (data?.base_code && data.base_code.toUpperCase() !== 'USD') {
        logger.error(`FX provider base is ${data.base_code}, expected USD (${url})`);
        return null;
      }

      const rate = Number(data?.rates?.NGN);

      if (!this._isPlausible(rate)) {
        logger.error(`FX provider returned an implausible USD→NGN rate: ${rate} (${url})`);
        return null;
      }

      logger.info(`FX rate refreshed from provider: 1 USD = ${rate} NGN`);

      return { rate, source: 'live', fetchedAt: new Date() };
    } catch (err) {
      logger.error(`FX provider request failed (${url}): ${err.message}`);
      return null;
    }
  }

  /**
   * Best-effort cache write. A failure here costs an extra provider call on the
   * next purchase, which is not worth failing a payment over.
   */
  async _writeCache({ rate }) {
    try {
      await CACHE_REF().set(
        {
          rate,
          provider: process.env.FX_PROVIDER_URL || DEFAULTS.PROVIDER_URL,
          fetchedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      logger.warn(`Could not cache FX rate: ${err.message}`);
    }
  }

  /**
   * Last resort. Deliberately still sanity-banded: a fat-fingered NGN_PER_USD is
   * no more trustworthy than a broken provider, and this value is only ever
   * consulted when nobody is watching the provider anyway.
   */
  _envFallback() {
    const rate = parseFloat(process.env.NGN_PER_USD);

    if (!this._isPlausible(rate)) {
      logger.error(
        `FX unavailable: provider failed and NGN_PER_USD is ${
          process.env.NGN_PER_USD === undefined ? 'unset' : `out of band (${process.env.NGN_PER_USD})`
        }. Refusing to price a Naira charge.`
      );
      throw new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, MESSAGES.FX_UNAVAILABLE);
    }

    logger.warn(`FX provider unavailable — using NGN_PER_USD fallback: 1 USD = ${rate} NGN`);

    return { rate, source: 'env-fallback', fetchedAt: new Date() };
  }
}

module.exports = new FxService();
