#!/usr/bin/env node
/**
 * Create or promote the single super_admin account.
 *
 * Usage:
 *   npm run create:superadmin
 *   npm run create:superadmin -- --email you@example.com --name "Ada" --force
 *
 * Credentials come from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD /
 * SUPER_ADMIN_NAME, or the matching flags. Idempotent: run it against an email
 * that already exists and it promotes that account rather than failing.
 *
 * Deliberately refuses to create a SECOND super_admin without --force. One
 * bootstrap account is the design; further admins are made from the console by
 * the super_admin, which leaves an audit entry. A script silently minting
 * privileged accounts does not.
 */
require('dotenv').config();

const { auth, db, FieldValue } = require('../config/firebase');
const { ROLES } = require('../utils/constants');
const referralService = require('../services/referral.service');

const parseArgs = (argv) => {
  const out = { force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') out.force = true;
    else if (arg === '--email') out.email = argv[++i];
    else if (arg === '--password') out.password = argv[++i];
    else if (arg === '--name') out.name = argv[++i];
  }
  return out;
};

const fail = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

(async () => {
  const args = parseArgs(process.argv.slice(2));

  const email = String(args.email || process.env.SUPER_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  const password = args.password || process.env.SUPER_ADMIN_PASSWORD || '';
  const fullName = args.name || process.env.SUPER_ADMIN_NAME || 'Super Admin';

  if (!email) {
    fail('Set SUPER_ADMIN_EMAIL in .env, or pass --email <address>.');
  }

  // Firebase enforces 6+ characters. Ask for more, because this one account can
  // disable every other account on the platform.
  if (password && password.length < 12) {
    fail('SUPER_ADMIN_PASSWORD must be at least 12 characters.');
  }

  const existingSupers = await db
    .collection('users')
    .where('role', '==', ROLES.SUPER_ADMIN)
    .get();

  let userRecord = null;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }

  const alreadySuper =
    userRecord && existingSupers.docs.some((d) => d.id === userRecord.uid);

  if (existingSupers.size > 0 && !alreadySuper && !args.force) {
    const owners = existingSupers.docs.map((d) => d.data().email).join(', ');
    fail(
      `A super_admin already exists (${owners}).\n` +
        `  Promote further admins from the console, or re-run with --force if you\n` +
        `  genuinely need a second one.`
    );
  }

  // ---- promote an existing account ----
  if (userRecord) {
    const ref = db.collection('users').doc(userRecord.uid);
    const doc = await ref.get();

    if (!doc.exists) {
      fail(
        `${email} exists in Firebase Auth but has no users/ document.\n` +
          `  That account predates the current signup flow; delete it in the\n` +
          `  Firebase console and re-run to create it cleanly.`
      );
    }

    await ref.update({
      role: ROLES.SUPER_ADMIN,
      isActive: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await auth.setCustomUserClaims(userRecord.uid, { role: ROLES.SUPER_ADMIN });

    if (password) {
      await auth.updateUser(userRecord.uid, { password });
    }
    // Existing sessions carry the old role in their token; drop them so the new
    // role applies on next sign-in.
    await auth.revokeRefreshTokens(userRecord.uid);

    console.log(`\n  Promoted existing account to super_admin`);
    console.log(`     email : ${email}`);
    console.log(`     uid   : ${userRecord.uid}`);
    if (password) console.log(`     password reset: yes`);
    console.log('\n  Sign in at the admin console with this address.\n');
    process.exit(0);
  }

  // ---- create a new account ----
  if (!password) {
    fail('SUPER_ADMIN_PASSWORD is required to create a new account (12+ chars).');
  }

  const created = await auth.createUser({
    email,
    password,
    displayName: fullName,
    emailVerified: true, // bootstrap account; there is no inbox flow to wait on
    disabled: false,
  });

  // Same document shape auth.service.js register() writes, so this account is
  // indistinguishable from a normal one everywhere except `role`.
  const referralCode = await referralService.generateUniqueReferralCode(fullName);
  const now = FieldValue.serverTimestamp();

  await db.collection('users').doc(created.uid).set({
    uid: created.uid,
    fullName,
    email,
    phone: null,
    role: ROLES.SUPER_ADMIN,
    profileImage: null,
    isVerified: true,
    isActive: true,
    referralCode,
    referredBy: null,
    balance: 0,
    sharesOwned: 0,
    totalInvested: 0,
    totalReferralEarnings: 0,
    createdAt: now,
    updatedAt: now,
    lastLogin: null,
  });

  await auth.setCustomUserClaims(created.uid, { role: ROLES.SUPER_ADMIN });

  console.log(`\n  Created super_admin`);
  console.log(`     email : ${email}`);
  console.log(`     uid   : ${created.uid}`);
  console.log(`     name  : ${fullName}`);
  console.log(
    '\n  The password is the one from your environment; it is not printed here.'
  );
  console.log('  Remove SUPER_ADMIN_PASSWORD from .env once you have signed in.\n');
  process.exit(0);
})().catch((error) => {
  console.error('\n  Failed to create super admin');
  console.error(`  ${error.message}\n`);
  process.exit(1);
});
