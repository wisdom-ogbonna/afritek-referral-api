const { Resend } = require('resend');
const ApiError = require('../utils/ApiError');
const { HTTP_STATUS } = require('../utils/constants');
const { logger } = require('../utils/logger');
const maskEmail = require('../utils/maskEmail');

const APP_NAME = 'Afritek';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Surface misconfiguration at boot rather than when a user first tries to sign up.
if (!resend) {
  logger.warn('RESEND_API_KEY is not set — verification and reset emails will fail');
}
if (!process.env.EMAIL_FROM) {
  logger.warn('EMAIL_FROM is not set — verification and reset emails will fail');
} else if (/^your/i.test(process.env.EMAIL_FROM)) {
  logger.warn(
    `EMAIL_FROM still looks like a placeholder ("${process.env.EMAIL_FROM}") — mail will arrive with the wrong sender name`
  );
}

/**
 * Shared shell so both emails look like one system. Inline styles only: every
 * mail client strips <style> blocks, and several strip background colours, so
 * the layout has to survive without them.
 */
const layout = ({ heading, body, ctaLabel, ctaUrl, footNote }) => `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#020617;font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#020617;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px;">
            <tr>
              <td style="padding-bottom:24px;">
                <span style="display:inline-block;background-color:#ba770a;color:#ffffff;font-weight:700;font-size:14px;width:32px;height:32px;line-height:32px;text-align:center;border-radius:8px;">A</span>
                <span style="color:#ffffff;font-size:18px;font-weight:600;margin-left:10px;vertical-align:middle;">${APP_NAME}</span>
              </td>
            </tr>
            <tr>
              <td style="color:#ffffff;font-size:22px;font-weight:700;padding-bottom:12px;">${heading}</td>
            </tr>
            <tr>
              <td style="color:#94a3b8;font-size:15px;line-height:24px;padding-bottom:28px;">${body}</td>
            </tr>
            <tr>
              <td style="padding-bottom:28px;">
                <a href="${ctaUrl}" style="display:inline-block;background-color:#ba770a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 26px;border-radius:10px;">${ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:13px;line-height:20px;padding-bottom:8px;">
                If the button does not work, paste this link into your browser:
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${ctaUrl}" style="color:#ebb819;font-size:12px;word-break:break-all;">${ctaUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #1e293b;padding-top:20px;color:#64748b;font-size:12px;line-height:19px;">
                ${footNote}
              </td>
            </tr>
          </table>
          <div style="color:#475569;font-size:11px;padding-top:20px;">
            © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

class EmailService {
  /**
   * The Resend SDK does NOT throw on API errors — it resolves with
   * { data: null, error: {...} }. A try/catch-only wrapper would therefore
   * report success on every failure, so the error field must be checked.
   */
  async _send({ to, subject, html, text }) {
    if (!resend || !process.env.EMAIL_FROM) {
      const missing = !resend ? 'RESEND_API_KEY' : 'EMAIL_FROM';
      logger.error(`Cannot send email to ${maskEmail(to)}: ${missing} is not configured`);
      throw new ApiError(
        HTTP_STATUS.INTERNAL_SERVER,
        'Email service is not configured'
      );
    }

    let result;
    try {
      result = await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html,
        text,
      });
    } catch (err) {
      // Network-level failure (DNS, timeout) — the SDK does throw for these.
      logger.error(`Resend request failed for ${maskEmail(to)}: ${err.message}`);
      throw new ApiError(HTTP_STATUS.INTERNAL_SERVER, 'Failed to send email');
    }

    const { data, error } = result;

    if (error) {
      logger.error(
        `Resend rejected mail to ${maskEmail(to)}: ${error.statusCode} ${error.name} — ${error.message}`
      );

      if (error.statusCode === 429) {
        throw new ApiError(
          HTTP_STATUS.TOO_MANY_REQUESTS,
          'Too many emails requested. Please wait a moment and try again.'
        );
      }

      throw new ApiError(
        HTTP_STATUS.INTERNAL_SERVER,
        `Failed to send email: ${error.message}`
      );
    }

    logger.info(`Email sent to ${maskEmail(to)} — subject "${subject}", id ${data?.id}`);
    return data;
  }

  async sendVerificationEmail(to, { fullName, link }) {
    const name = fullName ? fullName.split(' ')[0] : 'there';

    return this._send({
      to,
      subject: `Verify your ${APP_NAME} email address`,
      text: `Hi ${name},\n\nConfirm your email address to activate your ${APP_NAME} account:\n\n${link}\n\nThis link expires in about an hour. If you did not create an account, you can ignore this message.`,
      html: layout({
        heading: 'Verify your email',
        body: `Hi ${name}, confirm this email address to activate your ${APP_NAME} account.`,
        ctaLabel: 'Verify email address',
        ctaUrl: link,
        footNote:
          'This link expires in about an hour. If you did not create an account, you can safely ignore this email.',
      }),
    });
  }

  async sendPasswordResetEmail(to, { fullName, link }) {
    const name = fullName ? fullName.split(' ')[0] : 'there';

    return this._send({
      to,
      subject: `Reset your ${APP_NAME} password`,
      text: `Hi ${name},\n\nUse this link to choose a new password:\n\n${link}\n\nThis link expires in about an hour. If you did not request a password reset, you can ignore this message — your password will not change.`,
      html: layout({
        heading: 'Reset your password',
        body: `Hi ${name}, use the button below to choose a new password.`,
        ctaLabel: 'Choose a new password',
        ctaUrl: link,
        footNote:
          'This link expires in about an hour. If you did not request a password reset, you can safely ignore this email — your password will not change.',
      }),
    });
  }
}

module.exports = new EmailService();
