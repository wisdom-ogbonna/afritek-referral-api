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
   User shares: `https://yourapp.com/signup?ref=JOHN4F2A`  
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
    "referralLink": "http://localhost:3000/signup?ref=JOHN4F2A",
    "balance": 15000,
    "totalReferralEarnings": 15000,
    "directReferrals": 3,
    "secondLevelReferrals": 7,
    "level1Users": [
      {
        "uid": "...",
        "fullName": "Jane Doe",
        "email": "jane@example.com",
        "createdAt": "..."
      }
    ],
    "rates": {
      "level1": "15%",
      "level2": "5%"
    }
  }
}
```

> **`referralLink`** is the ready-to-share link. Users just copy and share it.

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

### 7.3 Buy Shares
Initiates payment with the selected gateway.

```
POST /shares/buy
Authorization: Bearer <idToken>
```

**Body**
```json
{
  "quantity": 5,
  "gateway": "paystack"
}
```

| Field    | Type   | Required | Allowed Values                  |
|----------|--------|----------|---------------------------------|
| quantity | number | Yes      | Integer ≥ 1                     |
| gateway  | string | Yes      | `paystack`, `stripe`, `paypal`  |

**Success Response (201) – Paystack**
```json
{
  "success": true,
  "message": "Payment initiated. Complete payment to receive shares.",
  "data": {
    "paymentId": "...",
    "reference": "SHR_ABC123XYZ",
    "amount": 100000,
    "quantity": 5,
    "gateway": "paystack",
    "authorizationUrl": "https://checkout.paystack.com/...",
    "publicKey": "pk_test_..."
  }
}
```

**Success Response (201) – Stripe**
```json
{
  "success": true,
  "data": {
    "paymentId": "...",
    "reference": "SHR_...",
    "amount": 100000,
    "quantity": 5,
    "gateway": "stripe",
    "clientSecret": "pi_..._secret_...",
    "publicKey": null
  }
}
```

**Success Response (201) – PayPal**
```json
{
  "success": true,
  "data": {
    "paymentId": "...",
    "reference": "SHR_...",
    "amount": 100000,
    "quantity": 5,
    "gateway": "paypal",
    "authorizationUrl": "https://www.sandbox.paypal.com/..."
  }
}
```

---

### 7.4 Verify Paystack Payment
Call this after the user completes payment on Paystack (or use webhook).

```
POST /shares/verify/paystack
Authorization: Bearer <idToken>
```

**Body**
```json
{
  "reference": "SHR_ABC123XYZ"
}
```

**Success Response (200)**
```json
{
  "success": true,
  "message": "Payment verified and shares credited",
  "data": {
    "success": true,
    "paymentId": "...",
    "quantity": 5
  }
}
```

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

### 8.2 Manual Deposit (Testing / Legacy)
```
POST /wallet/deposit
Authorization: Bearer <idToken>
```

**Body**
```json
{
  "amount": 50000,
  "description": "Test deposit"
}
```

This also triggers referral commissions.

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

### Recommended Test Order

1. `POST /auth/signup` → save tokens + referralCode
2. `POST /auth/signup` (second user with referralCode)
3. `POST /auth/login`
4. `GET /auth/me`
5. `GET /referrals/me`
6. `GET /shares`
7. `POST /shares/buy` (gateway: paystack)
8. Complete payment → `POST /shares/verify/paystack`
9. `GET /shares/me`
10. `GET /wallet`
11. `POST /withdrawals`
12. `GET /withdrawals/me`
13. Login as admin → `GET /withdrawals/pending`
14. `PATCH /withdrawals/:id/process`

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
| 200  | Success                | GET, PATCH, successful actions      |
| 201  | Created                | Signup, buy shares, withdrawal      |
| 400  | Bad Request            | Invalid data, insufficient shares  |
| 401  | Unauthorized            | Missing/invalid token               |
| 403  | Forbidden              | Wrong role or disabled account      |
| 404  | Not Found              | Resource does not exist             |
| 409  | Conflict               | Email already exists                |
| 422  | Validation Error       | express-validator failures          |
| 429  | Too Many Requests      | Rate limit exceeded                 |
| 500  | Internal Server Error  | Unexpected server error             |

---

**End of Documentation**
