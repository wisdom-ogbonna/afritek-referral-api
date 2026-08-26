/**
 * Reprice the existing ledger from a Naira base to the USD base.
 *
 *   npm run reprice:ledger            # dry run — reports, writes nothing
 *   npm run reprice:ledger -- --commit
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * Shares used to be priced at ₦20,000 each; they are now priced at
 * $SHARE_PRICE_USD (20). Every money row written before that change is a Naira
 * figure sitting in a field that the API now reads as USD — so a user who paid
 * ₦20,000 for one share reads back as having invested $20,000, and the wallet
 * tab shows a $19,980 unrealised loss.
 *
 * This is a REDENOMINATION, not an FX conversion. We are not asking "what was
 * ₦20,000 worth in dollars on the day it was paid" — nobody recorded a rate, and
 * guessing one would be inventing history. We are restating the same commercial
 * fact in the new unit: one share cost one share's worth, so
 *
 *     usd = ngn / (OLD_PRICE_NGN / NEW_PRICE_USD)      # 20000 / 20 = 1000
 *
 * The divisor is printed on every run. It is the only number that matters here,
 * and it is derived from the two prices rather than typed in twice.
 *
 * ---------------------------------------------------------------------------
 * WHY IT REFUSES TO GUESS
 * ---------------------------------------------------------------------------
 * A row is only converted when this script can *prove* it is still in Naira.
 * Anything it cannot classify is reported as AMBIGUOUS and left untouched —
 * converting an already-USD row would divide it by 1000 a second time, and that
 * is not recoverable from the data alone. Proof comes from, in order:
 *
 *   1. an explicit `ledgerCurrency` marker written by a previous run
 *   2. a per-share unit price that matches one base and not the other
 *      (₦20,000 vs $20 are three orders of magnitude apart — decisive)
 *   3. `createdAt` against the reprice cutoff, which is itself derived from the
 *      data (the first payment written by the new code) rather than assumed
 *
 * User aggregates get stronger treatment still: `totalInvested` and
 * `totalReferralEarnings` are pure sums of child rows, so they are RECOMPUTED
 * from the converted children rather than scaled. `balance` is a running figure,
 * so it is reconstructed from its components and cross-checked against the naive
 * scaling — and if the two disagree, or any of that user's child rows was
 * ambiguous, the whole user row is left alone and reported.
 *
 * Re-running is safe: converted docs carry `ledgerCurrency: 'USD'` and are
 * skipped.
 */
require('dotenv').config();
const { db, FieldValue } = require('../config/firebase');
const { SHARES, REFERRAL_RATES, WITHDRAWAL_STATUS } = require('../utils/constants');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

const hasFlag = (name) => argv.includes(`--${name}`);

const flagValue = (name, fallback = null) => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);

  const idx = argv.indexOf(`--${name}`);
  return idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('--')
    ? argv[idx + 1]
    : fallback;
};

const COMMIT = hasFlag('commit');
const VERBOSE = hasFlag('verbose');

const OLD_PRICE_NGN = parseFloat(flagValue('old-price-ngn', '20000'));
const NEW_PRICE_USD = SHARES.PRICE_USD;

// `usd = ngn / DIVISOR`. Derived, so the two prices cannot disagree with it.
const DIVISOR = OLD_PRICE_NGN / NEW_PRICE_USD;

// A unit price is "recognised" if it lands within this fraction of a base. Rows
// are not always exact: an old purchase may have been recorded from a rounded
// amount. 2% is far tighter than the 1000x gap between the two bases.
const UNIT_PRICE_TOLERANCE = 0.02;

const MARKER = 'USD';
const BATCH_SIZE = 400; // Firestore caps a write batch at 500.

const CLASS = {
  ALREADY: 'ALREADY_USD',
  NAIRA: 'NAIRA',
  AMBIGUOUS: 'AMBIGUOUS',
  EMPTY: 'NO_MONEY_FIELDS',
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const usd = (ngn) => Math.round((Number(ngn) / DIVISOR) * 100) / 100;
const money = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : String(n));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const near = (value, target) =>
  Number.isFinite(value) && target > 0 && Math.abs(value - target) / target <= UNIT_PRICE_TOLERANCE;

const toMillis = (ts) => {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : null;
};

const fetchAll = async (name) => {
  const snap = await db.collection(name).get();
  return snap.docs;
};

/**
 * Classify by unit price when a quantity is available — the strongest signal
 * there is, because it compares against both bases and demands exactly one match.
 */
const classifyByUnitPrice = (total, quantity) => {
  if (!(quantity > 0) || !Number.isFinite(total) || total === 0) return null;

  const unit = total / quantity;
  const looksNgn = near(unit, OLD_PRICE_NGN);
  const looksUsd = near(unit, NEW_PRICE_USD);

  if (looksNgn && !looksUsd) return CLASS.NAIRA;
  if (looksUsd && !looksNgn) return CLASS.ALREADY;

  return null;
};

// ---------------------------------------------------------------------------
// cutoff discovery
// ---------------------------------------------------------------------------

/**
 * When did the new code start writing?
 *
 * `amountUsd` is only ever set by the post-reprice initiatePurchase, so the
 * earliest payment carrying it marks the boundary. Anything created before that
 * instant was written by the Naira code. If no such payment exists the reprice
 * has not taken any money yet and everything is pre-reprice.
 */
const discoverCutoff = async (paymentDocs) => {
  const override = flagValue('cutoff');
  if (override) {
    const ms = Date.parse(override);
    if (!Number.isFinite(ms)) {
      throw new Error(`--cutoff is not a parseable date: ${override}`);
    }
    return { ms, source: `--cutoff ${override}` };
  }

  const stamps = paymentDocs
    .map((d) => d.data())
    .filter((p) => p.amountUsd !== undefined || p.chargeCurrency !== undefined)
    .map((p) => toMillis(p.quotedAt) || toMillis(p.createdAt))
    .filter(Boolean);

  if (!stamps.length) {
    return { ms: Date.now(), source: 'no post-reprice payments found; treating all rows as Naira' };
  }

  return {
    ms: Math.min(...stamps),
    source: 'earliest payment written by the new code',
  };
};

// ---------------------------------------------------------------------------
// per-collection planners
//
// Each returns { id, klass, reason, before:{}, after:{} } per document.
// `after` is only populated for CLASS.NAIRA.
// ---------------------------------------------------------------------------

const planSimple = ({ docs, fields, cutoffMs, label }) =>
  docs.map((doc) => {
    const data = doc.data();

    if (data.ledgerCurrency === MARKER) {
      return { id: doc.id, klass: CLASS.ALREADY, reason: 'ledgerCurrency marker', doc };
    }

    const present = fields.filter((f) => Number.isFinite(Number(data[f])) && Number(data[f]) !== 0);

    if (!present.length) {
      return { id: doc.id, klass: CLASS.EMPTY, reason: 'no non-zero money fields', doc };
    }

    const createdMs = toMillis(data.createdAt);

    if (createdMs === null) {
      return {
        id: doc.id,
        klass: CLASS.AMBIGUOUS,
        reason: `no createdAt and no marker — cannot date this ${label}`,
        doc,
      };
    }

    if (createdMs >= cutoffMs) {
      return { id: doc.id, klass: CLASS.ALREADY, reason: 'created after the cutoff', doc };
    }

    const before = {};
    const after = {};

    present.forEach((f) => {
      before[f] = num(data[f]);
      after[f] = usd(data[f]);
    });

    if (data.currency) after.currency = 'USD';

    return { id: doc.id, klass: CLASS.NAIRA, reason: 'created before the cutoff', doc, before, after };
  });

/**
 * Purchases carry `quantity`, so they can be classified on unit price alone —
 * no dependence on clocks or cutoffs.
 */
const planPurchases = (docs, cutoffMs) =>
  docs.map((doc) => {
    const data = doc.data();

    if (data.ledgerCurrency === MARKER) {
      return { id: doc.id, klass: CLASS.ALREADY, reason: 'ledgerCurrency marker', doc };
    }

    const quantity = num(data.quantity);
    const amountPaid = num(data.amountPaid);

    if (!amountPaid) {
      return { id: doc.id, klass: CLASS.EMPTY, reason: 'amountPaid is zero/absent', doc };
    }

    const byUnit = classifyByUnitPrice(amountPaid, quantity);
    const createdMs = toMillis(data.createdAt);
    const byDate = createdMs === null ? null : createdMs >= cutoffMs ? CLASS.ALREADY : CLASS.NAIRA;

    // Unit price wins — it is evidence from the row itself. Fall back to the date
    // only when the unit price matches neither base.
    const klass = byUnit || byDate;

    if (!klass) {
      return {
        id: doc.id,
        klass: CLASS.AMBIGUOUS,
        reason:
          `unit price ${money(amountPaid / (quantity || 1))} matches neither ` +
          `₦${OLD_PRICE_NGN} nor $${NEW_PRICE_USD}, and the row has no usable createdAt`,
        doc,
      };
    }

    if (klass === CLASS.ALREADY) {
      return { id: doc.id, klass, reason: byUnit ? 'unit price is already USD' : 'created after the cutoff', doc };
    }

    if (byUnit && byDate && byUnit !== byDate) {
      return {
        id: doc.id,
        klass: CLASS.AMBIGUOUS,
        reason: `unit price says ${byUnit} but createdAt says ${byDate}`,
        doc,
      };
    }

    // Re-derive from quantity where possible: exact, and it repairs rows whose
    // stored total had drifted from quantity × price.
    const derived = quantity > 0 ? Math.round(quantity * NEW_PRICE_USD * 100) / 100 : usd(amountPaid);

    return {
      id: doc.id,
      klass: CLASS.NAIRA,
      reason: byUnit ? 'unit price matches the old Naira base' : 'created before the cutoff',
      doc,
      before: { amountPaid, pricePerShare: num(data.pricePerShare) },
      after: {
        amountPaid: derived,
        pricePerShare: quantity > 0 ? NEW_PRICE_USD : usd(data.pricePerShare),
        currency: 'USD',
      },
    };
  });

/**
 * Payments keep their Naira figure — for a pre-reprice sale the Naira amount
 * genuinely WAS what the gateway collected, so it belongs in `chargeAmount`
 * rather than being thrown away. Only the ledger fields are restated.
 */
const planPayments = (docs, cutoffMs) =>
  docs.map((doc) => {
    const data = doc.data();

    if (data.ledgerCurrency === MARKER || data.amountUsd !== undefined) {
      return { id: doc.id, klass: CLASS.ALREADY, reason: 'already carries amountUsd', doc };
    }

    const quantity = num(data.quantity);
    const amount = num(data.amount);

    if (!amount) {
      return { id: doc.id, klass: CLASS.EMPTY, reason: 'amount is zero/absent', doc };
    }

    const byUnit = classifyByUnitPrice(amount, quantity);
    const createdMs = toMillis(data.createdAt);
    const byDate = createdMs === null ? null : createdMs >= cutoffMs ? CLASS.ALREADY : CLASS.NAIRA;
    const klass = byUnit || byDate;

    if (!klass) {
      return {
        id: doc.id,
        klass: CLASS.AMBIGUOUS,
        reason: `unit price ${money(amount / (quantity || 1))} matches neither base, no usable createdAt`,
        doc,
      };
    }

    if (klass === CLASS.ALREADY) {
      return { id: doc.id, klass, reason: 'looks already USD', doc };
    }

    const amountUsd = quantity > 0 ? Math.round(quantity * NEW_PRICE_USD * 100) / 100 : usd(amount);

    return {
      id: doc.id,
      klass: CLASS.NAIRA,
      reason: byUnit ? 'unit price matches the old Naira base' : 'created before the cutoff',
      doc,
      before: { amount, currency: data.currency || '(unset)' },
      after: {
        amount: amountUsd,
        amountUsd,
        currency: 'USD',
        pricePerShareUsd: quantity > 0 ? NEW_PRICE_USD : null,
        // Real history, preserved: this Naira figure is what was actually billed.
        chargeAmount: amount,
        chargeCurrency: data.currency || 'NGN',
        // Deliberately null: no rate was ever involved. The sale was priced in
        // Naira, so inventing an fxRate here would fabricate provenance.
        fxRate: null,
        fxSource: 'pre-usd-reprice',
      },
    };
  });

// ---------------------------------------------------------------------------
// user aggregates — recomputed, not scaled
// ---------------------------------------------------------------------------

/**
 * Rebuild each user's aggregates from the (post-conversion) child rows.
 *
 * Scaling `totalInvested` by the divisor would be wrong for anyone who bought
 * both before AND after the reprice: that field is a single running sum with no
 * record of which part is Naira. Summing the children has no such blind spot.
 *
 * `balance` cannot be summed the same way because withdrawals and admin credits
 * move it, so it is reconstructed from its components and cross-checked against
 * the naive scaling. Two situations make a user untouchable, and in both the row
 * is reported rather than written:
 *
 *   - one of their child rows is AMBIGUOUS, so the sum would mix Naira into a
 *     USD total and produce a number that is wrong in a way nobody can see;
 *   - the reconstructed balance disagrees with the scaled one, which means the
 *     balance moved by something this script does not model. Writing the
 *     reconstruction would then silently destroy real money — e.g. a balance
 *     credited by hand has no commission rows behind it and would reconstruct
 *     to zero.
 */
const planUsers = ({ userDocs, purchasePlans, commissionPlans, txPlans, withdrawalPlans }) => {
  const effective = (plan, field) =>
    plan.klass === CLASS.NAIRA ? num(plan.after[field]) : num(plan.doc.data()[field]);

  // uids whose children this script could not classify. Their aggregates cannot
  // be trusted, so they are excluded from writing entirely.
  const taintedUids = new Set();

  const accumulate = (plans, uidField, valueField, into) => {
    plans.forEach((p) => {
      const uid = p.doc.data()[uidField];
      if (!uid) return;

      if (p.klass === CLASS.AMBIGUOUS) {
        taintedUids.add(uid);
        return;
      }

      into.set(uid, num(into.get(uid)) + effective(p, valueField));
    });
  };

  const investedByUid = new Map();
  accumulate(purchasePlans, 'uid', 'amountPaid', investedByUid);

  const earningsByUid = new Map();
  accumulate(commissionPlans, 'toUid', 'amount', earningsByUid);

  const creditsByUid = new Map();
  txPlans.forEach((p) => {
    const data = p.doc.data();
    if (!data.uid || data.type !== 'admin_credit') return;
    if (p.klass === CLASS.AMBIGUOUS) {
      taintedUids.add(data.uid);
      return;
    }
    creditsByUid.set(data.uid, num(creditsByUid.get(data.uid)) + effective(p, 'amount'));
  });

  // A withdrawal holds funds unless it was rejected (withdrawal.service credits
  // the balance back on rejection), so rejected ones must not be subtracted.
  const heldByUid = new Map();
  withdrawalPlans.forEach((plan) => {
    const data = plan.doc.data();
    if (!data.uid) return;
    if (plan.klass === CLASS.AMBIGUOUS) {
      taintedUids.add(data.uid);
      return;
    }
    if (String(data.status) === String(WITHDRAWAL_STATUS.REJECTED)) return;
    heldByUid.set(data.uid, num(heldByUid.get(data.uid)) + effective(plan, 'amount'));
  });

  return userDocs.map((doc) => {
    const data = doc.data();

    if (data.ledgerCurrency === MARKER) {
      return { id: doc.id, klass: CLASS.ALREADY, reason: 'ledgerCurrency marker', doc };
    }

    const derivedInvested = Math.round(num(investedByUid.get(doc.id)) * 100) / 100;
    const derivedEarnings = Math.round(num(earningsByUid.get(doc.id)) * 100) / 100;
    const derivedBalance =
      Math.round(
        (num(earningsByUid.get(doc.id)) +
          num(creditsByUid.get(doc.id)) -
          num(heldByUid.get(doc.id))) *
          100
      ) / 100;

    const before = {
      totalInvested: num(data.totalInvested),
      balance: num(data.balance),
      totalReferralEarnings: num(data.totalReferralEarnings),
    };

    const untouched =
      !before.totalInvested && !before.balance && !before.totalReferralEarnings && !derivedInvested;

    if (untouched) {
      return { id: doc.id, klass: CLASS.EMPTY, reason: 'no money on this user', doc };
    }

    if (taintedUids.has(doc.id)) {
      return {
        id: doc.id,
        klass: CLASS.AMBIGUOUS,
        reason:
          'one or more of this user\'s purchase/commission/withdrawal rows is ' +
          'ambiguous, so their totals cannot be recomputed safely',
        doc,
      };
    }

    const scaledBalance = usd(before.balance);

    if (Math.abs(scaledBalance - derivedBalance) > 0.01) {
      return {
        id: doc.id,
        klass: CLASS.AMBIGUOUS,
        reason:
          `balance reconstructed from components ($${money(derivedBalance)}) disagrees with ` +
          `the scaled stored balance ($${money(scaledBalance)}, from ₦${money(before.balance)}). ` +
          'Something moved this balance that the script does not model — reconcile by hand.',
        doc,
      };
    }

    return {
      id: doc.id,
      klass: CLASS.NAIRA,
      reason: 'aggregates recomputed from child rows',
      doc,
      before,
      after: {
        totalInvested: derivedInvested,
        totalReferralEarnings: derivedEarnings,
        balance: derivedBalance,
      },
    };
  });
};

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

const report = (label, plans) => {
  const counts = plans.reduce((acc, p) => {
    acc[p.klass] = (acc[p.klass] || 0) + 1;
    return acc;
  }, {});

  const convert = plans.filter((p) => p.klass === CLASS.NAIRA);
  const ambiguous = plans.filter((p) => p.klass === CLASS.AMBIGUOUS);

  console.log(`\n── ${label} ─────────────────────────────────────`);
  console.log(
    `   ${plans.length} doc(s): ` +
      Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')
  );

  if (VERBOSE) {
    convert.forEach((p) => {
      const changes = Object.keys(p.after)
        .map((f) =>
          p.before[f] === undefined
            ? `${f} = ${money(p.after[f])} (new)`
            : `${f} ${money(p.before[f])} → ${money(p.after[f])}`
        )
        .join(', ');
      console.log(`   • ${p.id}  ${changes}`);
    });
  }

  ambiguous.forEach((p) => console.log(`   ⚠️  AMBIGUOUS ${p.id}: ${p.reason} (left untouched)`));

  return { convert, ambiguous };
};

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

const applyPlans = async (plans) => {
  const writes = plans.filter((p) => p.klass === CLASS.NAIRA);
  let written = 0;

  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();

    writes.slice(i, i + BATCH_SIZE).forEach((p) => {
      const payload = { ...p.after };

      // Drop keys we deliberately computed as null-but-meaningful only where the
      // field genuinely has no value to record.
      Object.keys(payload).forEach((k) => {
        if (payload[k] === undefined) delete payload[k];
      });

      batch.update(p.doc.ref, {
        ...payload,
        ledgerCurrency: MARKER,
        repricedAt: FieldValue.serverTimestamp(),
        repricedFrom: {
          oldPriceNgn: OLD_PRICE_NGN,
          newPriceUsd: NEW_PRICE_USD,
          divisor: DIVISOR,
        },
      });
    });

    await batch.commit();
    written += Math.min(BATCH_SIZE, writes.length - i);
    console.log(`   committed ${written}/${writes.length}`);
  }

  return written;
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (!Number.isFinite(OLD_PRICE_NGN) || OLD_PRICE_NGN <= 0) {
    throw new Error(`--old-price-ngn must be a positive number, got ${OLD_PRICE_NGN}`);
  }
  if (!Number.isFinite(NEW_PRICE_USD) || NEW_PRICE_USD <= 0) {
    throw new Error(`SHARE_PRICE_USD must be a positive number, got ${NEW_PRICE_USD}`);
  }

  console.log('════════════════════════════════════════════════════');
  console.log(`  Ledger reprice — ${COMMIT ? '⚠️  COMMIT (will write)' : 'DRY RUN (no writes)'}`);
  console.log('════════════════════════════════════════════════════');
  console.log(`  old base       ₦${OLD_PRICE_NGN} / share`);
  console.log(`  new base       $${NEW_PRICE_USD} / share`);
  console.log(`  divisor        usd = ngn / ${DIVISOR}`);
  console.log(`  commission     L1 ${REFERRAL_RATES.LEVEL_1}%, L2 ${REFERRAL_RATES.LEVEL_2}%`);

  const [userDocs, purchaseDocs, paymentDocs, commissionDocs, txDocs, withdrawalDocs] =
    await Promise.all([
      fetchAll('users'),
      fetchAll('purchases'),
      fetchAll('payments'),
      fetchAll('commissions'),
      fetchAll('transactions'),
      fetchAll('withdrawals'),
    ]);

  const cutoff = await discoverCutoff(paymentDocs);
  console.log(`  cutoff         ${new Date(cutoff.ms).toISOString()}`);
  console.log(`                 (${cutoff.source})`);

  const purchasePlans = planPurchases(purchaseDocs, cutoff.ms);
  const paymentPlans = planPayments(paymentDocs, cutoff.ms);

  const commissionPlans = planSimple({
    docs: commissionDocs,
    fields: ['amount', 'baseAmount'],
    cutoffMs: cutoff.ms,
    label: 'commission',
  });

  const txPlans = planSimple({
    docs: txDocs,
    fields: ['amount'],
    cutoffMs: cutoff.ms,
    label: 'transaction',
  });

  const withdrawalPlans = planSimple({
    docs: withdrawalDocs,
    fields: ['amount', 'fee', 'netAmount'],
    cutoffMs: cutoff.ms,
    label: 'withdrawal',
  });

  const userPlans = planUsers({
    userDocs,
    purchasePlans,
    commissionPlans,
    txPlans,
    withdrawalPlans,
  });

  const sections = [
    ['purchases', purchasePlans],
    ['payments', paymentPlans],
    ['commissions', commissionPlans],
    ['transactions', txPlans],
    ['withdrawals', withdrawalPlans],
    ['users (recomputed from the above)', userPlans],
  ];

  const results = sections.map(([label, plans]) => report(label, plans));

  const totalConvert = results.reduce((n, r) => n + r.convert.length, 0);
  const totalAmbiguous = results.reduce((n, r) => n + r.ambiguous.length, 0);

  console.log('\n════════════════════════════════════════════════════');
  console.log(`  ${totalConvert} doc(s) to reprice`);
  console.log(`  ${totalAmbiguous} ambiguous (skipped — needs a human)`);
  console.log('════════════════════════════════════════════════════');

  if (!VERBOSE && totalConvert) {
    console.log('\n  Re-run with --verbose to see every field change.');
  }

  if (!COMMIT) {
    console.log('\n  DRY RUN — nothing was written.');
    console.log('  Review the plan above, then re-run with --commit to apply it.\n');
    process.exit(0);
  }

  if (totalAmbiguous) {
    console.log(
      `\n  Proceeding, but ${totalAmbiguous} ambiguous doc(s) will be left as they are.\n`
    );
  }

  console.log('\n  Writing…');

  let written = 0;
  for (const [label, plans] of sections) {
    const n = await applyPlans(plans);
    if (n) console.log(`   ${label}: ${n} written`);
    written += n;
  }

  await db.collection('config').doc('ledgerReprice').set(
    {
      appliedAt: FieldValue.serverTimestamp(),
      oldPriceNgn: OLD_PRICE_NGN,
      newPriceUsd: NEW_PRICE_USD,
      divisor: DIVISOR,
      docsWritten: written,
      ambiguousSkipped: totalAmbiguous,
      cutoff: new Date(cutoff.ms).toISOString(),
      cutoffSource: cutoff.source,
    },
    { merge: true }
  );

  console.log(`\n  ✅ Repriced ${written} doc(s). Audit written to config/ledgerReprice.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Ledger reprice failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
