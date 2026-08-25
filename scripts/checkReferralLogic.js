/**
 * Standalone check for the multi-level referral payout logic.
 *
 * Stubs config/firebase with an in-memory Firestore so distributeCommissions can
 * be exercised without a project: level walk, idempotency, and cycle safety.
 *
 * Run: node scripts/checkReferralLogic.js
 */
const path = require('path');
const assert = require('assert');

// ---------- in-memory firestore double ----------
const INCREMENT = Symbol('increment');
const SERVER_TS = Symbol('serverTimestamp');

const store = new Map(); // "collection/doc" -> data

const key = (col, id) => `${col}/${id}`;

const applyWrite = (k, patch, merge) => {
  const current = merge ? store.get(k) || {} : {};
  const next = { ...current };

  for (const [field, value] of Object.entries(patch)) {
    if (value && value[INCREMENT] !== undefined) {
      next[field] = (Number(next[field]) || 0) + value[INCREMENT];
    } else if (value === SERVER_TS) {
      next[field] = '<ts>';
    } else {
      next[field] = value;
    }
  }

  store.set(k, next);
};

const snapshotOf = (k) => ({
  exists: store.has(k),
  id: k.split('/')[1],
  data: () => store.get(k),
});

const makeDocRef = (col, id) => ({
  _key: key(col, id),
  id,
  get: async () => snapshotOf(key(col, id)),
  set: async (data) => applyWrite(key(col, id), data, false),
  update: async (data) => applyWrite(key(col, id), data, true),
});

let autoId = 0;

const db = {
  collection: (col) => ({
    doc: (id) => makeDocRef(col, id || `auto_${(autoId += 1)}`),
    where: (field, op, value) => ({
      limit: () => ({ get: async () => queryGet(col, field, op, value) }),
      get: async () => queryGet(col, field, op, value),
      orderBy: () => ({ limit: () => ({ get: async () => queryGet(col, field, op, value) }) }),
    }),
  }),

  runTransaction: async (fn) => {
    // Sequential and non-contended, which is all these assertions need.
    await fn({
      get: async (ref) => snapshotOf(ref._key),
      set: (ref, data) => applyWrite(ref._key, data, false),
      update: (ref, data) => applyWrite(ref._key, data, true),
    });
  },
};

const queryGet = (col, field, op, value) => {
  const docs = [];

  for (const [k, data] of store.entries()) {
    if (!k.startsWith(`${col}/`)) continue;

    const actual = data[field];
    const match =
      op === '==' ? actual === value : op === 'in' ? value.includes(actual) : false;

    if (match) docs.push(snapshotOf(k));
  }

  return { empty: docs.length === 0, size: docs.length, docs };
};

const FieldValue = {
  increment: (n) => ({ [INCREMENT]: n }),
  serverTimestamp: () => SERVER_TS,
};

// ---------- inject the stub before referral.service resolves it ----------
const firebasePath = require.resolve(path.join(__dirname, '..', 'src', 'config', 'firebase.js'));
require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: { db, FieldValue, auth: {} },
};

process.env.REFERRAL_LEVEL1_RATE = '15';
process.env.REFERRAL_LEVEL2_RATE = '5';

const referralService = require('../src/services/referral.service');

const user = (uid, referredBy = null, extra = {}) => {
  store.set(key('users', uid), {
    uid,
    fullName: uid.toUpperCase(),
    email: `${uid}@example.com`,
    referralCode: uid.toUpperCase(),
    referredBy,
    balance: 0,
    totalReferralEarnings: 0,
    sharesOwned: 0,
    totalInvested: 0,
    ...extra,
  });
};

const balanceOf = (uid) => store.get(key('users', uid)).balance;
const commissionDocs = () =>
  [...store.keys()].filter((k) => k.startsWith('commissions/'));

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', `${name} — ${err.message}`]);
  }
};

(async () => {
  // ============ 1. two-level payout on a 200,000 purchase ============
  store.clear();
  user('grandparent');
  user('parent', 'grandparent');
  user('buyer', 'parent');

  let commissions = await referralService.distributeCommissions('buyer', 200000, 'TX1');

  check('level 1 gets 15%', () => assert.strictEqual(balanceOf('parent'), 30000));
  check('level 2 gets 5%', () => assert.strictEqual(balanceOf('grandparent'), 10000));
  check('buyer earns nothing on their own purchase', () =>
    assert.strictEqual(balanceOf('buyer'), 0));
  check('both levels reported', () => assert.strictEqual(commissions.length, 2));
  check('levels are labelled 1 and 2', () =>
    assert.deepStrictEqual(commissions.map((c) => c.level), [1, 2]));
  check('totalReferralEarnings tracks the credit', () =>
    assert.strictEqual(store.get(key('users', 'parent')).totalReferralEarnings, 30000));

  // ============ 2. idempotency: replaying the same transaction pays once ============
  const before = commissionDocs().length;
  commissions = await referralService.distributeCommissions('buyer', 200000, 'TX1');

  check('replay credits no extra balance to level 1', () =>
    assert.strictEqual(balanceOf('parent'), 30000));
  check('replay credits no extra balance to level 2', () =>
    assert.strictEqual(balanceOf('grandparent'), 10000));
  check('replay creates no new commission docs', () =>
    assert.strictEqual(commissionDocs().length, before));
  check('replay reports every level as skipped', () =>
    assert.ok(commissions.every((c) => c.skipped === true)));

  // ============ 3. a distinct transaction pays again ============
  await referralService.distributeCommissions('buyer', 200000, 'TX2');
  check('a second, different purchase pays level 1 again', () =>
    assert.strictEqual(balanceOf('parent'), 60000));

  // ============ 4. single-level upline stops cleanly ============
  store.clear();
  user('solo');
  user('newbuyer', 'solo');

  commissions = await referralService.distributeCommissions('newbuyer', 100000, 'TX3');
  check('lone referrer is paid level 1 only', () =>
    assert.strictEqual(commissions.length, 1));
  check('lone referrer gets 15%', () => assert.strictEqual(balanceOf('solo'), 15000));

  // ============ 5. no referrer at all ============
  store.clear();
  user('orphan');
  commissions = await referralService.distributeCommissions('orphan', 100000, 'TX4');
  check('an unreferred buyer pays no commission', () =>
    assert.strictEqual(commissions.length, 0));

  // ============ 6. referral cycle must not hang ============
  store.clear();
  user('alpha', 'beta');
  user('beta', 'alpha');

  commissions = await referralService.distributeCommissions('alpha', 100000, 'TX5');
  check('a cycle terminates instead of looping forever', () =>
    assert.ok(commissions.length <= 2));
  check('a cycle never pays the buyer themselves', () =>
    assert.ok(!commissions.some((c) => c.uid === 'alpha')));

  // ============ 7. stats expose both levels ============
  store.clear();
  user('root');
  user('l1a', 'root');
  user('l1b', 'root');
  user('l2a', 'l1a');
  await referralService.distributeCommissions('l1a', 200000, 'TX6'); // pays root L1
  await referralService.distributeCommissions('l2a', 200000, 'TX7'); // pays l1a L1, root L2

  const stats = await referralService.getReferralStats('root');

  check('direct referrals counted', () => assert.strictEqual(stats.directReferrals, 2));
  check('second level counted', () => assert.strictEqual(stats.secondLevelReferrals, 1));
  check('level 2 users are enumerated, not just counted', () =>
    assert.strictEqual(stats.level2Users.length, 1));
  check('level2 user is tagged level 2', () =>
    assert.strictEqual(stats.level2Users[0].level, 2));
  check('earnings split by level', () =>
    assert.deepStrictEqual(
      { l1: stats.earnings.level1, l2: stats.earnings.level2 },
      { l1: 30000, l2: 10000 }
    ));
  check('earnings total is the sum', () =>
    assert.strictEqual(stats.earnings.total, 40000));
  check('referral emails are masked in the network list', () =>
    assert.ok(stats.level1Users.every((u) => u.email.includes('***'))));
  check('totalReferrals covers both levels', () =>
    assert.strictEqual(stats.totalReferrals, 3));

  // ---------- report ----------
  const failed = results.filter(([s]) => s === 'FAIL');
  results.forEach(([s, n]) => console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}`));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
