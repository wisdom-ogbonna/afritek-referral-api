const ApiError = require('../utils/ApiError');
const { HTTP_STATUS, MESSAGES, ROLE_RANK } = require('../utils/constants');

/**
 * Role gate, by rank rather than by name.
 *
 * A caller passes when their rank is at least the LOWEST rank the route names,
 * so `authorize(ROLES.ADMIN)` admits admin and super_admin, and
 * `authorize(ROLES.SUPER_ADMIN)` admits only super_admin.
 *
 * This replaces an `if (req.user.role === 'admin') return next()` short-circuit
 * that ran before the allow-list was consulted. That gave every admin every
 * permission unconditionally, so introducing a higher role was impossible — a
 * plain admin would have satisfied authorize(SUPER_ADMIN) too. Ranking keeps the
 * inheritance that bypass was there to provide, without flattening the roles
 * into one.
 *
 * An unknown role ranks below `user`, so a corrupt or hand-edited role field
 * fails closed instead of being treated as privileged.
 */
const authorize = (...allowedRoles) => {
  const required = allowedRoles.length
    ? Math.min(...allowedRoles.map((role) => ROLE_RANK[role] ?? Infinity))
    : Infinity;

  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, MESSAGES.UNAUTHORIZED);
    }

    const rank = ROLE_RANK[req.user.role] ?? -1;

    if (rank < required) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, MESSAGES.FORBIDDEN);
    }

    next();
  };
};

module.exports = authorize;
