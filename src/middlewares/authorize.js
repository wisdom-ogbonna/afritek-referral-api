const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, MESSAGES.UNAUTHORIZED);
    }

    // Admin can access everything
    if (req.user.role === 'admin') {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ApiError(
        HTTP_STATUS.FORBIDDEN,
        MESSAGES.FORBIDDEN
      );
    }

    next();
  };
};

module.exports = authorize;
