const express = require('express');
const shareController = require('../controllers/share.controller');
const authenticate = require('../middlewares/authenticate');
const validate = require('../middlewares/validate');
const { buySharesValidator } = require('../validators/share.validator');

const router = express.Router();

// Public – anyone can see share info
router.get('/', shareController.getShareInfo);

// Protected
router.get('/me', authenticate, shareController.getMyShares);
router.post('/buy', authenticate, buySharesValidator, validate, shareController.buyShares);
router.post('/verify/paystack', authenticate, shareController.verifyPaystack);

module.exports = router;
