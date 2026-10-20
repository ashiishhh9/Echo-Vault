const validEmail = (value) => typeof value === 'string' && value.length <= 254
  && value === value.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function buildUnlockEmail({ title, unlockAt, appBaseUrl }) {
  const safeTitle = escapeHtml(title);
  const base = new URL(appBaseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Email application link must use an HTTP or HTTPS URL without credentials');
  const link = new URL('/', base.origin).toString();
  const date = new Date(unlockAt);
  const unlockDate = Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' }) : '';
  const dateCopy = unlockDate ? `It became available on ${unlockDate}.` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f5f2ec;font-family:Arial,sans-serif;color:#24211c"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:16px;padding:36px"><tr><td><p style="margin:0 0 24px;color:#8a6b34;font-size:13px;letter-spacing:2px;text-transform:uppercase">Digital Time Capsule</p><h1 style="font-size:28px;line-height:1.25;margin:0 0 18px">Your memory is ready to be opened!</h1><p style="font-size:16px;line-height:1.6;margin:0 0 8px">The capsule <strong>${safeTitle}</strong> is ready for you.</p><p style="font-size:15px;line-height:1.6;color:#625d54;margin:0 0 26px">${escapeHtml(dateCopy || 'A moment you saved for the future is waiting.')}</p><p style="margin:0 0 26px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#92713b;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold">Open your archive</a></p><p style="font-size:13px;line-height:1.5;color:#777">Sign in to your account to view your capsule. Its contents stay private and are never included in this email.</p></td></tr></table></td></tr></table></body></html>`;
  const text = [
    'Digital Time Capsule', '', 'Your memory is ready to be opened!', '',
    `The capsule "${title}" is ready for you.`, dateCopy,
    '', 'Open your archive:', link,
    '', 'Sign in to your account to view your capsule. Its contents are not included in this email.',
  ].filter((line) => line !== undefined).join('\n');
  return { subject: 'Your memory is ready to be opened!', html, text };
}

export function createResendEmailService({ apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM, timeoutMs = 10_000 } = {}) {
  let resendPromise;
  return {
    configured: Boolean(apiKey && from),
    async send({ recipient, subject, html, text, idempotencyKey }) {
      if (!validEmail(recipient)) return { accepted: false, retryable: false, error: 'Invalid recipient address' };
      if (!apiKey || !from) return { accepted: false, retryable: false, error: 'Email delivery is not configured' };
      try {
        resendPromise ??= import('resend').then(({ Resend }) => new Resend(apiKey));
        const resend = await resendPromise;
        const { data, error } = await resend.emails.send(
          { from, to: [recipient], subject, html, text },
          { idempotencyKey, signal: AbortSignal.timeout(timeoutMs) },
        );
        if (error) {
          const status = Number(error.statusCode);
          const retryable = status === 429 || status >= 500 || !Number.isFinite(status) || status === 0;
          const description = status === 401 || status === 403 ? 'Email provider authentication or sender configuration failed'
            : status === 422 || status === 400 ? 'Email provider rejected the message as invalid'
              : status === 429 ? 'Email provider rate limit reached'
                : status >= 500 ? 'Email provider temporarily unavailable' : 'Email provider request failed';
          return { accepted: false, retryable, error: description };
        }
        if (!data?.id) return { accepted: false, retryable: true, error: 'Email provider returned no message identifier' };
        return { accepted: true, messageId: data.id };
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return { accepted: false, retryable: true, error: timedOut ? 'Email provider request timed out; provider acceptance is unknown' : 'Email provider network failure; provider acceptance is unknown' };
      }
    },
  };
}

export { validEmail };
