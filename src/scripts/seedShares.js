/**
 * Run once (safe to re-run): npm run seed:shares
 *
 * Creates the global shares config document, or reprices an existing one.
 *
 * This used to bail out with "already exists" whenever the doc was present,
 * which meant a price change in the environment could never reach Firestore —
 * the buy screen kept quoting the seeded figure. The actual create/reprice logic
 * now lives in shareService.getPriceUsd() so the API and this script cannot
 * disagree about the price; this is just a CLI around it.
 *
 * Only `pricePerShare` and `currency` are touched on an existing doc. The
 * inventory counters (totalShares / remainingShares / soldShares) are left
 * alone — they are transaction state, not configuration.
 */
require('dotenv').config();
const { db } = require('../config/firebase');
const { SHARES } = require('../utils/constants');
const shareService = require('../services/share.service');

async function seed() {
  const ref = db.collection('config').doc('shares');
  const before = await ref.get();

  const priceUsd = await shareService.getPriceUsd();

  const after = (await ref.get()).data();

  if (!before.exists) {
    console.log(`✅ Shares seeded: ${SHARES.TOTAL} shares @ $${priceUsd}`);
  } else {
    const prev = before.data();
    const repriced = prev.pricePerShare !== priceUsd || prev.currency !== SHARES.CURRENCY;

    console.log(
      repriced
        ? `✅ Shares repriced: ${prev.currency} ${prev.pricePerShare} → ${SHARES.CURRENCY} ${priceUsd}`
        : `✅ Shares config already at ${SHARES.CURRENCY} ${priceUsd}; nothing to change`
    );
  }

  console.log({
    totalShares: after.totalShares,
    remainingShares: after.remainingShares,
    soldShares: after.soldShares || 0,
    pricePerShare: after.pricePerShare,
    currency: after.currency,
  });

  // Repricing config/shares does NOT restate existing purchases, balances or
  // commissions. Ledger rows written before the USD reprice are still Naira —
  // see `npm run reprice:ledger` for that.
  console.log(
    '\nℹ️  This only reprices configuration. Pre-existing Naira ledger rows are\n' +
      '   unchanged — run `npm run reprice:ledger` to inspect them.'
  );

  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
