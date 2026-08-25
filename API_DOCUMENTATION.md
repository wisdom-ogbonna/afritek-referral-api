# API Documentation

**Firebase Auth + Referral + Share Investment API**  
Version: `2.0.0`  
Base URL: `http://localhost:5000/api/v1`  
Content-Type: `application/json`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Authorization & Roles](#2-authorization--roles)
3. [Response Format](#3-response-format)
4. [Error Format](#4-error-format)
5. [Auth Endpoints](#5-auth-endpoints)
6. [Referral Endpoints](#6-referral-endpoints)
7. [Share Endpoints](#7-share-endpoints)
8. [Wallet Endpoints](#8-wallet-endpoints)
9. [Withdrawal Endpoints](#9-withdrawal-endpoints)
10. [Webhook Endpoints](#10-webhook-endpoints)
11. [Business Rules](#11-business-rules)
12. [Postman Testing Guide](#12-postman-testing-guide)

---

## 1. Authentication

Most endpoints require a **Firebase ID Token**.

```
Authorization: Bearer <idToken>
```

You receive the `idToken` after successful **Signup** or **Login**.

Token can be refreshed using the `/auth/refresh-token` endpoint.

---

## 2. Authorization & Roles

| Role       | Access Level                                      |
|------------|---------------------------------------------------|
| `user`     | Own resources only                                |
| `moderator`| Moderator-level routes                            |
| `admin`    | Full access to all routes + user management       |

Use the middleware pattern:
- `authenticate` → requires valid token
- `authorize("admin")` → requires specific role

---

## 3. Response Format

**Success**
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

**Error**
```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "email",
      "message": "Email is required"
    }
  ]
}
```

---

## 4. Error Format

| Status Code | Meaning                  |
|-------------|--------------------------|
| 200         | OK                       |
| 201         | Created                  |
| 400         | Bad Request              |
| 401         | Unauthorized             |
| 403         | Forbidden                |
| 404         | Not Found                |
| 409         | Conflict                 |
| 422         | Validation Error         |
| 429         | Too Many Requests        |
| 500         | Internal Server Error    |

---

## 5. Auth Endpoints

### 5.1 Sign Up
Register a new user. Optionally pass a referral code.

```
POST /auth/signup
```

**Body**
```json
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass1!",
  "phone": "+2348012345678",
  "referralCode": "JOHN4F2A"
}
```

| Field         | Type   | Required | Description                          |
|---------------|--------|----------|--------------------------------------|
| fullName      | string | Yes      | 2–100 characters                     |
| email         | string | Yes      | Valid email                          |
| password      | string | Yes      | Min 8 chars, upper, lower, number, special |
| phone         | string | No       | E.164 format                         |
| referralCode  | string | No       | Existing user’s referral code        |

**Success Response (201)**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "uid": "abc123...",
      "fullName": "John Doe",
      "email": "john@example.com",
      "phone": "+2348012345678",
      "role": "user",
      "referralCode": "JOHN4F2A",
      "referredBy": null,
      "balance": 0,
      "sharesOwned": 0,
      "totalInvested": 0,
      "isVerified": false,
      "isActive": true
    },
    "tokens": {
      "idToken": "eyJhbGciOi...",
      "refreshToken": "AMf-vBz...",
      "expiresIn": "3600"
    }
  }
}
```

---

### 5.2 Login
```
POST /auth/login
```

**Body**
```json
{
  "email": "john@example.com",
  "password": "SecurePass1!"
}
```

**Success Response (200)** – same structure as signup (user + tokens)

---

### 5.3 Logout
Revokes all refresh tokens for the user.

```
POST /auth/logout
Authorization: Bearer <idToken>
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "Logged out successfully",
  "data": null
}
```

---

### 5.4 Refresh Token
```
POST /auth/refresh-token
```

**Body**
```json
{
  "refreshToken": "AMf-vBz..."
}
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "tokens": {
      "idToken": "eyJhbGciOi...",
      "refreshToken": "AMf-vBz...",
      "expiresIn": "3600"
    }
  }
}
```

---

### 5.5 Forgot Password
```
POST /auth/forgot-password
```

**Body**
```json
{
  "email": "john@example.com"
}
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "If an account with that email exists, a password reset link has been sent",
  "data": null
}
```

---

### 5.6 Reset Password
```
POST /auth/reset-password
```

**Body**
```json
{
  "oobCode": "code-from-email",
  "newPassword": "NewSecurePass2!"
}
```

---

### 5.7 Send Email Verification
```
POST /auth/send-email-verification
Authorization: Bearer <idToken>
```

---

### 5.8 Verify Email
```
POST /auth/verify-email
```

**Body**
```json
{
  "oobCode": "code-from-email"
}
```

---

### 5.9 Change Password
```
PATCH /auth/change-password
Authorization: Bearer <idToken>
```

**Body**
```json
{
  "currentPassword": "SecurePass1!",
  "newPassword": "NewSecurePass2!"
}
```

---

### 5.10 Get Current User
```
GET /auth/me
Authorization: Bearer <idToken>
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "User profile retrieved",
  "data": {
    "user": {
      "uid": "abc123...",
      "fullName": "John Doe",
      "email": "john@example.com",
      "phone": "+2348012345678",
      "role": "user",
      "referralCode": "JOHN4F2A",
      "referredBy": null,
      "balance": 15000,
      "sharesOwned": 5,
      "totalInvested": 100000,
      "totalReferralEarnings": 15000,
      "isVerified": true,
      "isActive": true,
      "createdAt": "...",
      "updatedAt": "...",
      "lastLogin": "..."
    }
  }
}
```

---

### 5.11 Update Profile
```
PATCH /auth/profile
Authorization: Bearer <idToken>
```

**Body**
```json
{
  "fullName": "John Updated",
  "phone": "+2348099999999",
  "profileImage": "https://example.com/avatar.jpg"
}
```

---

### 5.12 Delete Own Account
```
DELETE /auth/account
Authorization: Bearer <idToken>
```

---

### 5.13 Delete Any Account (Admin)
```
DELETE /auth/account/:uid
Authorization: Bearer <adminIdToken>
```

---

## 6. Referral Endpoints

Referral works in **two ways**:

1. **Shareable Link** (recommended)  
   User shares: `https://yourapp.com/register?ref=JOHN4F2A`  
   Frontend extracts `ref` and sends it as `referralCode` during signup.

2. **Manual code entry** during signup (still supported).

### 6.1 Resolve Referral Code (Public)
Used when someone opens a referral link. Frontend calls this to show “You were invited by John Doe”.

```
GET /referrals/resolve/:code
```

**Example**
```
GET /referrals/resolve/JOHN4F2A
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "Referral code is valid",
  "data": {
    "valid": true,
    "referralCode": "JOHN4F2A",
    "referrer": {
      "fullName": "John Doe"
    }
  }
}
```

**Error (400)** – invalid or non-existent code
```json
{
  "success": false,
  "message": "Invalid or expired referral code",
  "errors": []
}
```

---

### 6.2 Get My Referral Stats + Shareable Link
```
GET /referrals/me
Authorization: Bearer <idToken>
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "Referral stats retrieved successfully",
  "data": {
    "referralCode": "JOHN4F2A",
    "referralLink": "https://afritek-web.vercel.app/register?ref=JOHN4F2A",
    "referredBy": null,
    "balance": 15000,
    "totalReferralEarnings": 40000,
    "directReferrals": 3,
    "secondLevelReferrals": 7,
    "totalReferrals": 10,
    "level1Users": [
      {
        "uid": "...",
        "fullName": "Jane Doe",
        "email": "ja***@example.com",
        "level": 1,
        "sharesOwned": 5,
        "totalInvested": 100000,
        "isVerified": true,
        "createdAt": "..."
      }
    ],
    "level2Users": [
      {
        "uid": "...",
        "fullName": "Sam Ade",
        "email": "sa***@example.com",
        "level": 2,
        "sharesOwned": 2,
        "totalInvested": 40000,
        "isVerified": true,
        "createdAt": "..."
      }
    ],
    "earnings": {
      "level1": 30000,
      "level2": 10000,
      "total": 40000
    },
    "rates": {
      "level1": "15%",
      "level2": "5%",
      "level1Percent": 15,
      "level2Percent": 5
    }
  }
}
```

> **`referralLink`** is the ready-to-share link, built from `FRONTEND_URL` and the
> frontend's `/register` route. Users just copy and share it.
>
> **`level2Users`** enumerates the second commission level, not just a count, so the
> whole referral tree is visible in one call. Emails of other users are masked.
>
> **`earnings`** is derived from the `commissions` ledger, split per level;
> `totalReferralEarnings` is the denormalised counter on the user document and
> should match `earnings.total`.

---

## 7. Share Endpoints

**Business Rules**
- Total Shares: **1,000,000**
- Price per Share: **₦20,000**
- Buying shares triggers referral commissions (15% + 5%)

### 7.1 Get Share Information (Public)
```
GET /shares
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "Share info retrieved",
  "data": {
    "totalShares": 1000000,
    "remainingShares": 999850,
    "soldShares": 150,
    "pricePerShare": 20000,
    "currency": "NGN",
    "totalValue": 20000000000
  }
}
```

---

### 7.2 Get My Shares
```
GET /shares/me
Authorization: Bearer <idToken>
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "Your shares retrieved",
  "data": {
    "sharesOwned": 5,
    "totalInvested": 100000,
    "currentValue": 100000,
    "purchases": [
      {
        "id": "...",
        "quantity": 5,
        "amountPaid": 100000,
        "pricePerShare": 20000,
        "gateway": "paystack",
        "status": "completed",
        "createdAt": "..."
      }
    ]
  }
}
```

---

### 7.3 Buy Shares — the single payment endpoint

```
POST /shares/buy
Authorization: Bearer <idToken>
```

One endpoint handles the whole purchase for **all three gateways**. It has two
modes, and you call it twice per purchase:

| Mode | You send | It does |
|---|---|---|
| `initiate` | `quantity` + `gateway` | Creates a pending payment, returns what the gateway needs you to act on |
| `verify` | `reference` | Confirms with the gateway, credits shares, pays referral commissions, updates the payment status |

**Mode selection.** Send `action` explicitly, or leave it out and it is inferred:
no `reference` means `initiate`, a `reference` means `verify`. All four of these
are valid:

```json
{ "quantity": 5, "gateway": "paystack" }                  // initiate
{ "action": "initiate", "quantity": 5, "gateway": "paystack" }
{ "reference": "SHR_7A903BE5FC8B45B8" }                   // verify
{ "action": "verify", "reference": "SHR_7A903BE5FC8B45B8" }
```

Sending `action: "initiate"` together with a `reference` is contradictory and
returns `422`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `action` | string | No | `initiate` or `verify`. Inferred when omitted. |
| `quantity` | number | initiate only | Integer ≥ 1 |
| `gateway` | string | initiate only | `paystack`, `stripe`, `paypal` |
| `reference` | string | verify only | The `SHR_…` reference from initiate |
| `orderId` | string | No | PayPal only. Normally unnecessary — the order id is stored at initiate. |

---

#### Mode 1 — initiate

**Request**
```json
{ "quantity": 5, "gateway": "paystack" }
```

**Response (201) — Paystack.** Redirect the user to `authorizationUrl`.
```json
{
  "statusCode": 201,
  "success": true,
  "message": "Payment initiated. Complete payment to receive shares.",
  "data": {
    "action": "initiate",
    "paymentId": "VI6fGNUOoEvhhNxzNjBq",
    "reference": "SHR_7A903BE5FC8B45B8",
    "amount": 100000,
    "currency": "NGN",
    "quantity": 5,
    "gateway": "paystack",
    "status": "pending",
    "authorizationUrl": "https://checkout.paystack.com/7lvssc3qi9lxz6s",
    "clientSecret": null,
    "publicKey": "pk_test_...",
    "orderId": null
  }
}
```

**Response (201) — Stripe.** Confirm `clientSecret` with Stripe.js on the client.
```json
{
  "statusCode": 201,
  "success": true,
  "data": {
    "action": "initiate",
    "paymentId": "...",
    "reference": "SHR_...",
    "amount": 100000,
    "currency": "NGN",
    "quantity": 5,
    "gateway": "stripe",
    "status": "pending",
    "authorizationUrl": null,
    "clientSecret": "pi_..._secret_...",
    "publicKey": "pk_test_...",
    "orderId": null
  }
}
```
> `publicKey` is `STRIPE_PUBLISHABLE_KEY`. If that env var is unset it comes back
> `null` and Stripe.js cannot initialise — set it.

**Response (201) — PayPal.** Redirect the user to `authorizationUrl`.
```json
{
  "statusCode": 201,
  "success": true,
  "data": {
    "action": "initiate",
    "paymentId": "...",
    "reference": "SHR_...",
    "amount": 100000,
    "currency": "NGN",
    "quantity": 5,
    "gateway": "paypal",
    "status": "pending",
    "authorizationUrl": "https://www.sandbox.paypal.com/checkoutnow?token=...",
    "clientSecret": null,
    "publicKey": null,
    "orderId": "5O190127TN364715T"
  }
}
```

---

#### Mode 2 — verify

Call this when the user returns to your callback page (see §7.5), or after
Stripe.js reports success. Keep the `reference` from the initiate response.

**Request**
```json
{ "reference": "SHR_7A903BE5FC8B45B8" }
```

Per gateway, verification re-checks the payment server-side: Paystack's
transaction verify API, Stripe's PaymentIntent, or the PayPal order — and for
PayPal an approved order is **captured** here, which is when the money actually
moves.

**Response (200)**
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Payment verified successfully and shares credited",
  "data": {
    "action": "verify",
    "paymentId": "VI6fGNUOoEvhhNxzNjBq",
    "reference": "SHR_7A903BE5FC8B45B8",
    "status": "completed",
    "quantity": 5,
    "amount": 100000,
    "currency": "NGN",
    "gateway": "paystack",
    "alreadyProcessed": false,
    "shares": { "sharesOwned": 5, "totalInvested": 100000 },
    "commissions": [
      { "uid": "...", "level": 1, "amount": 15000, "skipped": false },
      { "uid": "...", "level": 2, "amount": 5000, "skipped": false }
    ]
  }
}
```

**`alreadyProcessed: true`** (still `200`) means the payment was already
completed — usually because the webhook got there first. This is the normal,
expected outcome, not an error. Shares are credited exactly once regardless of
how many times you call verify, and `commissions` is `[]` because this call did
not distribute them.

**Errors**

| Status | When |
|---|---|
| `400` | Gateway says the payment is not successful yet. `errors[0].message` carries the gateway's own status, e.g. `Gateway status: abandoned`. Safe to retry — the payment stays `pending` and the checkout link stays usable. |
| `403` | The reference belongs to a different user. |
| `404` | No payment with that reference. |
| `422` | Validation — bad `reference` format, missing `quantity`/`gateway`, unknown `action`, or `action`/`reference` conflict. |
| `502` | The gateway itself is unreachable or misconfigured (bad API key, network failure). Not your session — do **not** log the user out. |

> A `400` from verify is not final. A user who has not finished paying yet gets
> `400` with `Gateway status: abandoned`; they can still complete the payment on
> the same link and a later verify will succeed.

---

### 7.5 Payment callback (what your frontend must serve)

The backend sends users to these URLs on your app (`FRONTEND_URL`), so the
frontend needs routes for them:

| URL | Sent by | What to do |
|---|---|---|
| `/payment/callback?gateway=paystack` | Paystack, after checkout | Read the stored `reference`, call `POST /shares/buy` with it |
| `/payment/callback?gateway=paypal` | PayPal, after approval | Same — the stored `reference` is what matters |
| `/payment/cancel` | PayPal, if the user cancels | Show a cancelled state; the payment stays `pending` |

Paystack also appends its own `reference` and `trxref` query params; PayPal
appends `token` (the order id) and `PayerID`. You can use them, but the
`reference` you saved at initiate is the authoritative key for this API.

**Recommended flow:** persist `reference` (e.g. `sessionStorage`) at initiate,
then verify on return. Because both verify and the webhook converge on the same
idempotent completion, it is safe to verify immediately, retry on `400`, and
verify again later — the user can never be credited twice or charged twice.

---


## 8. Wallet Endpoints

### 8.1 Get Wallet
```
GET /wallet
Authorization: Bearer <idToken>
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "Wallet retrieved successfully",
  "data": {
    "balance": 15000,
    "totalReferralEarnings": 15000,
    "sharesOwned": 5,
    "totalInvested": 100000,
    "pricePerShare": 20000,
    "currentValue": 100000,
    "totalReturns": 0,
    "recentCommissions": [
      {
        "id": "...",
        "fromUid": "...",
        "level": 1,
        "amount": 15000,
        "baseAmount": 100000,
        "rate": 15,
        "createdAt": "..."
      }
    ]
  }
}
```

---

### 8.2 Manual Balance Credit (Admin only)
```
POST /wallet/credit
Authorization: Bearer <idToken>   ← must be an admin
```

**Body**
```json
{
  "amount": 50000,
  "uid": "target_user_uid",
  "description": "Goodwill adjustment"
}
```

`uid` is optional and defaults to the calling admin.

> **Replaces the old `POST /wallet/deposit`.** That endpoint was open to any
> authenticated user, so anyone could credit their own balance for free *and*
> trigger real 15%/5% referral payouts to their upline on money that had never
> been collected — then withdraw it. It is now admin-only, writes an audited
> `admin_credit` transaction recording which admin performed it, and deliberately
> pays **no** referral commissions.
>
> Referral commissions are earned from gateway-verified share purchases only
> (`paymentService.completePayment`). There is no self-service deposit.

---

## 9. Withdrawal Endpoints

### 9.1 Request Withdrawal
```
POST /withdrawals
Authorization: Bearer <idToken>
```

**Body**
```json
{
  "amount": 15000,
  "accountName": "John Doe",
  "accountNumber": "0123456789",
  "bankCode": "058",
  "bankName": "GTBank"
}
```

| Field         | Type   | Required | Description                |
|---------------|--------|----------|----------------------------|
| amount        | number | Yes      | ≥ minimum withdrawal       |
| accountName   | string | Yes      | Account holder name        |
| accountNumber | string | Yes      | 10-digit Nigerian account  |
| bankCode      | string | Yes      | Bank code (e.g. 058)       |
| bankName      | string | No       | Bank name                  |

**Success Response (201)**
```json
{
  "success": true,
  "message": "Withdrawal request submitted successfully",
  "data": {
    "withdrawalId": "...",
    "amount": 15000,
    "fee": 0,
    "netAmount": 15000,
    "status": "pending"
  }
}
```

> Balance is deducted immediately and held until approved/rejected.

---

### 9.2 Get My Withdrawals
```
GET /withdrawals/me
Authorization: Bearer <idToken>
```

---

### 9.3 List Pending Withdrawals (Admin)
```
GET /withdrawals/pending
Authorization: Bearer <adminIdToken>
```

---

### 9.4 Process Withdrawal (Admin)
```
PATCH /withdrawals/:id/process
Authorization: Bearer <adminIdToken>
```

**Body – Approve**
```json
{
  "action": "approve",
  "note": "Paid via bank transfer"
}
```

**Body – Reject**
```json
{
  "action": "reject",
  "note": "Invalid account details"
}
```

> On reject, the amount is refunded to the user’s wallet balance.

---

## 10. Webhook Endpoints

These are called by the payment providers. Do **not** call them manually from Postman unless testing.

```
POST /webhooks/paystack
POST /webhooks/stripe
POST /webhooks/paypal
```

Configure these URLs in your provider dashboards:

```
https://your-domain.com/api/v1/webhooks/paystack
https://your-domain.com/api/v1/webhooks/stripe
https://your-domain.com/api/v1/webhooks/paypal
```

**Why these still exist alongside `POST /shares/buy`.** Verification via
`/shares/buy` is client-driven, so it only happens if the user comes back to your
app. Webhooks are the safety net for the user who pays and then closes the tab —
they are the only thing that credits that purchase. Keep them configured.

Both routes converge on the same idempotent completion logic, so a webhook and a
client verify arriving at the same instant credit the shares once and pay each
referral commission once. Verified against 6 simultaneous duplicate deliveries.

| Provider | Events handled | Signature verification |
|---|---|---|
| Paystack | `charge.success` | HMAC-SHA512 of the body against `x-paystack-signature`, keyed on `PAYSTACK_SECRET_KEY` |
| Stripe | `payment_intent.succeeded` | `stripe.webhooks.constructEvent` against `STRIPE_WEBHOOK_SECRET` (needs the raw body — this router is mounted before the JSON parser) |
| PayPal | `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED` | **None yet** — verify with the PayPal SDK before production |

`CHECKOUT.ORDER.APPROVED` only means the payer approved the order; the webhook
captures it before crediting anything, so shares are never issued against money
that was not actually taken.

---

## 11. Business Rules

| Rule                        | Value                          |
|-----------------------------|--------------------------------|
| Total Shares                | 1,000,000                      |
| Price per Share             | ₦20,000                        |
| 1st Generation Commission   | 15% of purchase amount         |
| 2nd Generation Commission   | 5% of purchase amount          |
| Currency                    | NGN (primary)                  |
| Min Withdrawal              | Configurable (default ₦1,000)  |

**Commission Flow Example**
- User C buys 5 shares (₦100,000)
- User B (direct referrer) receives ₦15,000 (15%)
- User A (2nd level) receives ₦5,000 (5%)

Commissions are paid once per payment. Each commission document has a
deterministic id (`<paymentId>_L1`, `<paymentId>_L2`), so replayed webhooks and
repeated verify calls cannot double-credit a referrer.

---

## 12. Postman Testing Guide

### Environment Variables
| Variable       | Value                              |
|----------------|------------------------------------|
| `baseUrl`      | `http://localhost:5000/api/v1`     |
| `idToken`      | *(set after login/signup)*         |
| `refreshToken` | *(set after login/signup)*         |
| `uid`          | *(set after login/signup)*         |
| `referralCode` | *(set after signup)*               |
| `reference`    | *(set from the initiate response)* |

### Recommended Test Order

1. `POST /auth/signup` → save tokens + referralCode
2. `POST /auth/signup` (second user with referralCode)
3. `POST /auth/login`
4. `GET /auth/me`
5. `GET /referrals/me`
6. `GET /shares`
7. `POST /shares/buy` with `{"quantity": 1, "gateway": "paystack"}` → save `reference`
8. Open `authorizationUrl`, pay with the test card below
9. `POST /shares/buy` with `{"reference": "{{reference}}"}` → shares credited
10. `POST /shares/buy` with the same `reference` again → `200` with `alreadyProcessed: true`
11. `GET /shares/me`
12. `GET /wallet`
13. `POST /withdrawals`
14. `GET /withdrawals/me`
15. Login as admin → `GET /withdrawals/pending`
16. `PATCH /withdrawals/:id/process`

> Step 9 before paying returns `400` with `Gateway status: abandoned` — that is
> correct, and the payment stays payable.

### Paystack Test Card
```
Card Number: 4084084084084081
Expiry: any future date
CVV: any 3 digits
PIN: 0000
OTP: 123456
```

---

## Status Codes Summary

| Code | Meaning                | When it happens                     |
|------|------------------------|-------------------------------------|
| 200  | Success                | GET, PATCH, verified payment        |
| 201  | Created                | Signup, payment initiated, withdrawal |
| 400  | Bad Request            | Invalid data, insufficient shares, payment not completed yet |
| 401  | Unauthorized            | Missing/invalid token               |
| 403  | Forbidden              | Wrong role, disabled account, or another user's payment |
| 404  | Not Found              | Resource does not exist             |
| 409  | Conflict               | Email already exists                |
| 422  | Validation Error       | express-validator failures          |
| 429  | Too Many Requests      | Rate limit exceeded                 |
| 500  | Internal Server Error  | Unexpected server error             |
| 502  | Bad Gateway            | Payment provider unreachable or misconfigured |

---

**End of Documentation**
