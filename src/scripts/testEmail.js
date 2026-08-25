/**
 * Send real verification + password-reset emails to an address you control,
 * so you can confirm they actually land in an inbox.
 *
 *   npm run test:email -- you@yourdomain.com
 *
 * Exercises the real production path: Admin SDK generates the link, Resend
 * delivers it. Uses an account that already exists, so it creates nothing.
 */
require('dotenv').config();
const authService = require('../services/auth.service');
const { auth } = require('../config/firebase');

const email = process.argv[2];

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

(async () => {
  if (!email || !email.includes('@')) {
    die('Pass the address to send to:  npm run test:email -- you@yourdomain.com');
  }

  console.log(`\nProject     : ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`Sending from: ${process.env.EMAIL_FROM || '(EMAIL_FROM not set)'}`);
  console.log(`Sending to  : ${email}`);
  console.log(`Links built : ${process.env.FRONTEND_URL || '(FRONTEND_URL not set)'}\n`);

  // The address must already have an account.
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      die(
        `No account exists for ${email}.\n` +
          `  Register it first (through the app, or POST /api/v1/auth/signup),\n` +
          `  which will itself send a verification email you can check for.`
      );
    }
    die(`Lookup failed: ${err.code || err.message}`);
  }

  console.log(`✓ Account found — uid ${user.uid}, emailVerified=${user.emailVerified}\n`);

  let failures = 0;

  // Password-reset email.
  try {
    await authService.forgotPassword(email);
    console.log('✓ Password-reset email sent');
  } catch (err) {
    failures += 1;
    console.log(`✗ Password-reset FAILED: ${err.message}`);
  }

  // Verification email.
  try {
    const result = await authService.sendEmailVerification(email);
    if (result.alreadyVerified) {
      console.log('– Verification skipped: address is already verified');
      console.log('  (To retest, unverify it in the Firebase console first.)');
    } else {
      console.log('✓ Verification email sent');
    }
  } catch (err) {
    failures += 1;
    console.log(`✗ Verification FAILED: ${err.message}`);
  }

  if (failures) {
    console.log(`
Something failed above. Most likely causes:

  "domain is not verified"  -> verify afritektech.com in Resend > Domains,
                               or set EMAIL_FROM to onboarding@resend.dev
                               (which only delivers to your own Resend address)
  "not configured"          -> RESEND_API_KEY or EMAIL_FROM missing from .env
  FRONTEND_URL not set      -> needed to build the links
`);
    process.exit(1);
  }

  console.log(`
Now check ${email} — including the spam folder.

Each link points at ${process.env.FRONTEND_URL}/reset-password and /verify-email,
so make sure that is where afritek-web is actually served.
`);

  process.exit(0);
})();
