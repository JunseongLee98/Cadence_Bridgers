import { NextRequest, NextResponse } from 'next/server';
import { EMAIL_FEATURES_ENABLED } from '@/lib/email-features';
import { buildNotificationEmailHtml, sendMail } from '@/lib/mail';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NotificationPayload = {
  title: string;
  body?: string;
};

export async function POST(request: NextRequest) {
  if (!EMAIL_FEATURES_ENABLED) {
    return NextResponse.json({ error: 'Email features are disabled.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const notifications = Array.isArray(body.notifications) ? body.notifications : [];

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 });
    }

    const items: NotificationPayload[] = notifications
      .filter((n: unknown) => n && typeof n === 'object')
      .map((n: { title?: unknown; body?: unknown }) => ({
        title: typeof n.title === 'string' ? n.title : 'Cadence update',
        body: typeof n.body === 'string' ? n.body : undefined,
      }))
      .filter((n: NotificationPayload) => Boolean(n.title));

    if (items.length === 0) {
      return NextResponse.json({ error: 'No notifications to send.' }, { status: 400 });
    }

    const result = await sendMail({
      to: email,
      subject:
        items.length === 1
          ? `Cadence: ${items[0].title}`
          : `Cadence: ${items.length} new notifications`,
      html: buildNotificationEmailHtml(items, username || undefined),
      text: items.map((n) => `${n.title}${n.body ? `\n${n.body}` : ''}`).join('\n\n'),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    console.error('notifications/email:', error);
    return NextResponse.json({ error: 'Failed to send notification email.' }, { status: 500 });
  }
}
