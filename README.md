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
| POST   | /buy               | Required | Initiate purchase (choose gateway)               |
| POST   | /verify/paystack   | Required | Manually verify Paystack payment                 |

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

---

## Example: Buy Shares with Paystack

```http
POST /api/v1/shares/buy
Authorization: Bearer <idToken>
Content-Type: application/json

{
  "quantity": 5,
  "gateway": "paystack"
}
```

**Response**
```json
{
  "success": true,
  "message": "Payment initiated. Complete payment to receive shares.",
  "data": {
    "paymentId": "...",
    "reference": "SHR_ABC123...",
    "amount": 100000,
    "quantity": 5,
    "gateway": "paystack",
    "authorizationUrl": "https://checkout.paystack.com/...",
    "publicKey": "pk_test_..."
  }
}
```

Redirect the user to `authorizationUrl`. After payment, Paystack webhook (or `/verify/paystack`) credits the shares and pays the 15%/5% commissions.

### Stripe
```json
{
  "quantity": 2,
  "gateway": "stripe"
}
```
Returns `clientSecret` → use Stripe.js on frontend.

### PayPal
```json
{
  "quantity": 10,
  "gateway": "paypal"
}
```
Returns `authorizationUrl` → redirect user.

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
