/**
 * Keep addresses out of the logs in readable form while staying diagnosable.
 * we***@afritektech.com  — enough to correlate a report with a log line,
 * not enough to be a dump of user emails.
 */
const maskEmail = (email = '') => {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
};

module.exports = maskEmail;
