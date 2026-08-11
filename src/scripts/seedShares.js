/**
 * Run once: npm run seed:shares
 * Creates / updates the global shares config document
 */
require('dotenv').config();
const { db, FieldValue } = require('../config/firebase');
const { SHARES } = require('../utils/constants');

async function seed() {
  const ref = db.collection('config').doc('shares');
  const snap = await ref.get();

  if (snap.exists) {
    console.log('Shares config already exists:', snap.data());
    process.exit(0);
  }

  await ref.set({
    totalShares: SHARES.TOTAL,
    remainingShares: SHARES.TOTAL,
    pricePerShare: SHARES.PRICE,
    currency: SHARES.CURRENCY,
    soldShares: 0,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log(`✅ Shares seeded: ${SHARES.TOTAL} shares @ ₦${SHARES.PRICE}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
