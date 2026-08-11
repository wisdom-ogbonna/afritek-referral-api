const express = require('express');
const withdrawalController = require('../controllers/withdrawal.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const {
  withdrawValidator,
  processWithdrawalValidator,
} = require('../validators/withdrawal.validator');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.post('/', authenticate, withdrawValidator, validate, withdrawalController.requestWithdrawal);
router.get('/me', authenticate, withdrawalController.getMyWithdrawals);

// Admin only
router.get('/pending', authenticate, authorize(ROLES.ADMIN), withdrawalController.listPending);
router.patch(
  '/:id/process',
  authenticate,
  authorize(ROLES.ADMIN),
  processWithdrawalValidator,
  validate,
  withdrawalController.processWithdrawal
);

module.exports = router;
