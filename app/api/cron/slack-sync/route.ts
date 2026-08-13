import { NextRequest, NextResponse } from 'next/server';
import { loadCalendarFeed } from '@/lib/calendar-feed-store';
import {
  clearSlackStatus,
  postSlackDirectMessage,
  setSlackStatus,
} from '@/lib/slack-client';
import { listSlackConnections, saveSlackConnection } from '@/lib/slack-store';
import {
  formatDigestMessage,
  formatReminderMessage,
  planSlackSync,
  SLACK_SYNC_TICK_MS,
  type SlackSyncEvent,
} from '@/lib/slack-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (process.env.VERCEL === '1') {
    if (!secret) return false;
    return request.headers.get('authorization') === `Bearer ${secret}`;
  }
  if (!secret) return true;
  const header = request.headers.get('authorization');
  const query = request.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

function feedEventsToSyncEvents(
  events: Array<{ id: string; title: string; start: string; end: string }>
): SlackSyncEvent[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    start: new Date(e.start),
    end: new Date(e.end),
  }));
}

export async function GET(request: NextRequest) {
  try {
    if (!authorizeCron(request)) {
      const status = process.env.VERCEL === '1' && !process.env.CRON_SECRET ? 503 : 401;
      return NextResponse.json(
        { error: status === 503 ? 'CRON_SECRET is not configured' : 'Unauthorized' },
        { status }
      );
    }

    const now = new Date();
    const connections = await listSlackConnections();
    let scanned = 0;
    let statusSet = 0;
    let statusCleared = 0;
    let digests = 0;
    let reminders = 0;
    let skippedNoFeed = 0;
    const errors: string[] = [];

    for (const connection of connections) {
      scanned += 1;
      const needsWork =
        connection.statusSyncEnabled ||
        connection.digestEnabled ||
        typeof connection.reminderMinutesBefore === 'number';
      if (!needsWork) continue;

      if (!connection.calendarFeedToken) {
        skippedNoFeed += 1;
        continue;
      }

      try {
        const feed = await loadCalendarFeed(connection.calendarFeedToken);
        const events = feedEventsToSyncEvents(feed?.events ?? []);
        const plan = planSlackSync(events, now, {
          statusSyncEnabled: connection.statusSyncEnabled,
          digestEnabled: connection.digestEnabled,
          reminderMinutesBefore: connection.reminderMinutesBefore,
          timeZone: connection.timeZone,
          lastStatusEventId: connection.lastStatusEventId,
          lastDigestDate: connection.lastDigestDate,
          remindedEventIds: connection.remindedEventIds,
        });

        if (plan.setStatus) {
          await setSlackStatus(connection.accessToken, {
            text: plan.setStatus.text,
            emoji: plan.setStatus.emoji,
            expirationUnix: plan.setStatus.expirationUnix,
          });
          statusSet += 1;
        } else if (plan.clearStatus) {
          await clearSlackStatus(connection.accessToken);
          statusCleared += 1;
        }

        const botToken = connection.botAccessToken;
        if (botToken && plan.digestLines?.length) {
          await postSlackDirectMessage(
            botToken,
            connection.slackUserId,
            formatDigestMessage(plan.digestLines)
          );
          digests += 1;
        }

        if (botToken) {
          for (const reminder of plan.reminders) {
            await postSlackDirectMessage(
              botToken,
              connection.slackUserId,
              formatReminderMessage(reminder)
            );
            reminders += 1;
          }
        }

        await saveSlackConnection({
          ...connection,
          lastStatusEventId: plan.nextLastStatusEventId,
          lastDigestDate: plan.nextLastDigestDate,
          remindedEventIds: plan.nextRemindedEventIds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('slack-sync user failed', connection.googleSub, err);
        errors.push(`${connection.googleSub}: ${message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      tickMs: SLACK_SYNC_TICK_MS,
      scanned,
      statusSet,
      statusCleared,
      digests,
      reminders,
      skippedNoFeed,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    console.error('slack-sync cron:', error);
    const message = error instanceof Error ? error.message : 'Slack sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
