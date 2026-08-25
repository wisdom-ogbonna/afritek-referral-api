# Firebase Auth + Referral + Share Investment API

**Modern production-ready backend** with:

- Full Authentication & RBAC
- 2-Level Referral System (15% + 5%)
- Share Purchase System (**1,000,000 shares @ ₦20,000 each**)
- Payment Gateways: **Paystack**, **Stripe**, **PayPal**
- Wallet + **Withdrawal** system
- Webhooks for all payment providers

---

## Business Rules

| Item                    | Value              |
|-------------------------|--------------------|
| Total Shares            | 1,000,000          |
| Price per Share         | ₦20,000            |
| 1st Generation Referral | 15% of purchase    |
| 2nd Generation Referral | 5% of purchase     |
| Currency                | NGN (primary)      |

When a user buys shares, the amount paid is used to calculate referral commissions automatically.

---

## Tech Stack

- Node.js + Express.js
- Firebase Auth + Admin SDK + Cloud Firestore
- Paystack / Stripe / PayPal
- express-validator, helmet, cors, rate-limit, compression

---

## Quick Start

```bash
npm install
cp .env.example .env
# Fill all keys (Firebase, Paystack, Stripe, PayPal)

# Seed the shares inventory (run once)
npm run seed:shares

npm run dev
```

Server: `http://localhost:5000`

---

## Complete Endpoint List

### Auth  `/api/v1/auth`
| Method | Endpoint                    | Auth     | Description                  |
|--------|-----------------------------|----------|------------------------------|
| POST   | /signup                     | Public   | Register (+ optional referralCode) |
| POST   | /login                      | Public   | Login                        |
| POST   | /logout                     | Required | Revoke tokens                |
| POST   | /refresh-token              | Public   | Refresh ID token             |
| POST   | /forgot-password            | Public   | Send reset email             |
| POST   | /reset-password             | Public   | Confirm reset                |
| POST   | /send-email-verification    | Required | Send verification            |
| POST   | /verify-email               | Public   | Confirm email                |
| PATCH  | /change-password            | Required | Change password              |
| GET    | /me                         | Required | Current user profile         |
| PATCH  | /profile                    | Required | Update profile               |
| DELETE | /account                    | Required | Delete own account           |
| DELETE | /account/:uid               | Admin    | Delete any user              |

### Referrals  `/api/v1/referrals`
| Method | Endpoint | Auth     | Description                          |
|--------|----------|----------|--------------------------------------|
| GET    | /me      | Required | My code, stats, earnings, downline   |

### Wallet  `/api/v1/wallet`
| Method | Endpoint  | Auth     | Description                          |
|--------|-----------|----------|--------------------------------------|
| GET    | /         | Required | Balance + recent commissions         |
| POST   | /deposit  | Required | Manual deposit (legacy/testing)      |

### Shares  `/api/v1/shares`
| Method | Endpoint           | Auth     | Description                                      |
|--------|--------------------|----------|--------------------------------------------------|
| GET    | /                  | Public   | Total / remaining shares, price, value           |
| GET    | /me                | Required | My shares owned + purchase history               |
| POST   | /buy               | Required | **The single payment endpoint** — initiate *and* verify, all gateways |

### Withdrawals  `/api/v1/withdrawals`
| Method | Endpoint         | Auth     | Description                          |
|--------|------------------|----------|--------------------------------------|
| POST   | /                | Required | Request withdrawal                   |
| GET    | /me              | Required | My withdrawal history                |
| GET    | /pending         | Admin    | List pending withdrawals             |
| PATCH  | /:id/process     | Admin    | Approve or reject withdrawal         |

### Webhooks  `/api/v1/webhooks`
| Method | Endpoint   | Description                |
|--------|------------|----------------------------|
| POST   | /paystack  | Paystack payment webhook   |
| POST   | /stripe    | Stripe payment webhook     |
| POST   | /paypal    | PayPal payment webhook     |

Webhooks stay alongside `POST /shares/buy`: they are what credits a user who pays
and then closes the tab. Both routes share the same idempotent completion, so
shares are credited once and each commission paid once no matter how the two race.

---

## Example: Buy Shares

`POST /shares/buy` is the only payment endpoint. It covers Paystack, Stripe and
PayPal, and handles initiation, verification, share crediting, referral
commissions and payment status. You call it **twice** per purchase.

### 1. Initiate

```http
POST /api/v1/shares/buy
Authorization: Bearer <idToken>
Content-Type: application/json

{
  "quantity": 5,
  "gateway": "paystack"
}
```

**Response (201)**
```json
{
  "statusCode": 201,
  "success": true,
  "message": "Payment initiated. Complete payment to receive shares.",
  "data": {
    "action": "initiate",
    "paymentId": "...",
    "reference": "SHR_7A903BE5FC8B45B8",
    "amount": 100000,
    "currency": "NGN",
    "quantity": 5,
    "gateway": "paystack",
    "status": "pending",
    "authorizationUrl": "https://checkout.paystack.com/...",
    "clientSecret": null,
    "publicKey": "pk_test_...",
    "orderId": null
  }
}
```

Save the `reference`, then send the user to pay:

| Gateway  | What to do with the response                          |
|----------|-------------------------------------------------------|
| Paystack | Redirect to `authorizationUrl`                        |
| Stripe   | Confirm `clientSecret` with Stripe.js (`publicKey` = `STRIPE_PUBLISHABLE_KEY`) |
| PayPal   | Redirect to `authorizationUrl` (`orderId` is stored server-side) |

### 2. Verify

Call the same endpoint with the saved `reference` when the user returns:

```http
POST /api/v1/shares/buy
Authorization: Bearer <idToken>
Content-Type: application/json

{
  "reference": "SHR_7A903BE5FC8B45B8"
}
```

**Response (200)**
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Payment verified successfully and shares credited",
  "data": {
    "action": "verify",
    "reference": "SHR_7A903BE5FC8B45B8",
    "status": "completed",
    "quantity": 5,
    "alreadyProcessed": false,
    "shares": { "sharesOwned": 5, "totalInvested": 100000 },
    "commissions": [
      { "uid": "...", "level": 1, "amount": 15000, "skipped": false },
      { "uid": "...", "level": 2, "amount": 5000, "skipped": false }
    ]
  }
}
```

This step verifies with the gateway (and **captures** the PayPal order), credits
the shares, pays the 15%/5% commissions and updates the payment status.

Notes:
- `action` is optional — omit it and the mode is inferred from whether you sent a
  `reference`. Send `action: "initiate"` / `"verify"` if you prefer it explicit.
- `alreadyProcessed: true` with `200` means the webhook got there first. Normal,
  not an error.
- `400` means the gateway has not seen the payment yet; the payment stays
  `pending` and the link stays usable, so retrying is safe.
- `502` means the gateway is unreachable or misconfigured — **not** an auth
  problem, so don't log the user out.

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md#73-buy-shares--the-single-payment-endpoint)
for the full contract, including the `/payment/callback` routes your frontend
needs to serve.

---

## Withdrawal Example

```http
POST /api/v1/withdrawals
Authorization: Bearer <idToken>
Content-Type: application/json

{
  "amount": 50000,
  "accountName": "John Doe",
  "accountNumber": "0123456789",
  "bankCode": "058",
  "bankName": "GTBank"
}
```

Admin later:
```http
PATCH /api/v1/withdrawals/<id>/process
Authorization: Bearer <adminToken>

{
  "action": "approve",
  "note": "Paid via Paystack Transfer"
}
```

---

## Firestore Collections

- `users` – profile + balance + sharesOwned + referralCode
- `config/shares` – total / remaining inventory
- `payments` – every payment attempt
- `purchases` – successful share purchases
- `commissions` – referral earnings log
- `withdrawals` – withdrawal requests
- `transactions` – wallet movements

---

## Environment Variables

See `.env.example` for full list. Critical ones:

```env
TOTAL_SHARES=1000000
SHARE_PRICE=20000
PAYSTACK_SECRET_KEY=sk_test_...
STRIPE_SECRET_KEY=sk_test_...
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

---

## Security

- Helmet + CORS + Rate limiting
- Firebase ID token verification (with revocation check)
- Webhook signature verification (Paystack & Stripe)
- Input validation on every endpoint
- Atomic Firestore transactions for shares & balance

---

## License

MIT
