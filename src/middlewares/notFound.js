const ApiError = require('../utils/ApiError');
const { HTTP_STATUS } = require('../utils/constants');

const notFound = (req, res, next) => {
  next(new ApiError(HTTP_STATUS.NOT_FOUND, `Route ${req.originalUrl} not found`));
};

module.exports = notFound;
