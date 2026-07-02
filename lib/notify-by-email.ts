import type { InAppNotification, UserProfile } from '@/types';

/** Sends notification copies to the user's verified email when enabled. */
export async function sendEmailNotificationsForUser(
  user: UserProfile,
  notifications: InAppNotification[]
): Promise<void> {
  if (!user.emailVerified || !user.emailNotificationsEnabled) return;
  if (!notifications.length) return;

  try {
    await fetch('/api/notifications/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        username: user.username,
        notifications: notifications.map((n) => ({ title: n.title, body: n.body })),
      }),
    });
  } catch (err) {
    console.warn('Failed to send notification email', err);
  }
}
