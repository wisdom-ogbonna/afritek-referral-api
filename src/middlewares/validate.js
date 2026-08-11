const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const extractedErrors = errors.array().map((err) => ({
      field: err.path || err.param,
      message: err.msg,
    }));

    throw new ApiError(HTTP_STATUS.UNPROCESSABLE, MESSAGES.VALIDATION_ERROR, extractedErrors);
  }

  next();
};

module.exports = validate;
