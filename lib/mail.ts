import { Resend } from 'resend';

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type SendMailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; skipped?: boolean };

function getFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    'Cadence <onboarding@resend.dev>'
  );
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === 'development') {
      console.info('[mail] RESEND_API_KEY not set — email not sent:', {
        to: input.to,
        subject: input.subject,
      });
      return { ok: true, id: 'dev-skipped' };
    }
    return {
      ok: false,
      error: 'Email service is not configured (RESEND_API_KEY).',
      skipped: true,
    };
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: getFromAddress(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (error) {
    return { ok: false, error: error.message || 'Failed to send email' };
  }

  return { ok: true, id: data?.id };
}

export function buildVerificationEmailHtml(verifyUrl: string, username?: string): string {
  const greeting = username ? `Hi ${escapeHtml(username)},` : 'Hi,';
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; color: #373147;">
      <p>${greeting}</p>
      <p>Please confirm your email address for Cadence so we can send you schedule notifications.</p>
      <p style="margin: 24px 0;">
        <a href="${verifyUrl}" style="background: #494262; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Verify email
        </a>
      </p>
      <p style="font-size: 13px; color: #666;">If the button does not work, copy this link into your browser:</p>
      <p style="font-size: 13px; word-break: break-all;"><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="font-size: 12px; color: #888;">This link expires in 24 hours.</p>
    </div>
  `.trim();
}

export function buildNotificationEmailHtml(
  items: Array<{ title: string; body?: string }>,
  username?: string
): string {
  const greeting = username ? `Hi ${escapeHtml(username)},` : 'Hi,';
  const rows = items
    .map(
      (n) => `
      <li style="margin-bottom: 12px;">
        <strong>${escapeHtml(n.title)}</strong>
        ${n.body ? `<div style="color:#555;font-size:14px;margin-top:4px;">${escapeHtml(n.body)}</div>` : ''}
      </li>`
    )
    .join('');
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; color: #373147;">
      <p>${greeting}</p>
      <p>You have new updates from Cadence:</p>
      <ul style="padding-left: 20px;">${rows}</ul>
      <p style="font-size: 12px; color: #888;">Open Cadence to see your calendar and tasks.</p>
    </div>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
