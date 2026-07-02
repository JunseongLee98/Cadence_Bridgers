import { NextRequest, NextResponse } from 'next/server';
import { EMAIL_FEATURES_ENABLED } from '@/lib/email-features';
import { createEmailVerificationToken } from '@/lib/verification-token';
import { buildVerificationEmailHtml, sendMail } from '@/lib/mail';
import { getAppOrigin } from '@/lib/app-origin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  if (!EMAIL_FEATURES_ENABLED) {
    return NextResponse.json({ error: 'Email features are disabled.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    const token = createEmailVerificationToken(email);
    const origin = getAppOrigin(request);
    const verifyUrl = `${origin}/api/auth/verify-email/confirm?token=${encodeURIComponent(token)}`;

    const result = await sendMail({
      to: email,
      subject: 'Verify your email for Cadence',
      html: buildVerificationEmailHtml(verifyUrl, username || undefined),
      text: `Verify your Cadence email: ${verifyUrl}`,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ ok: true, message: 'Verification email sent.' });
  } catch (error) {
    console.error('verify-email send:', error);
    return NextResponse.json({ error: 'Failed to send verification email.' }, { status: 500 });
  }
}
