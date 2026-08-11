const express = require('express');
const walletController = require('../controllers/wallet.controller');
const authenticate = require('../middlewares/authenticate');
const validate = require('../middlewares/validate');
const { depositValidator } = require('../validators/wallet.validator');

const router = express.Router();

// Deposit / Purchase – triggers 15% L1 + 5% L2 commissions
router.post('/deposit', authenticate, depositValidator, validate, walletController.deposit);

// Get my wallet balance + recent commissions
router.get('/', authenticate, walletController.getWallet);

module.exports = router;
