import { CalendarEvent } from '@/types';
import { fetchGoogleCalendarEventsRest } from '@/lib/google-calendar-rest';
import {
  assertGoogleOAuthEnv,
  createGoogleOAuth2Client,
} from '@/lib/google-oauth-env';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  // Needed for Calendars.insert (creating the dedicated "Cadence" secondary calendar)
  'https://www.googleapis.com/auth/calendar',
];

/** Exchange a refresh token for a fresh access token (access tokens expire ~1h). */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = assertGoogleOAuthEnv();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to refresh Google token: ${text || res.statusText}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Google refresh response missing access_token');
  }
  return data.access_token;
}

export function getAuthClient(accessToken: string) {
  const oauth2Client = createGoogleOAuth2Client();

  oauth2Client.setCredentials({
    access_token: accessToken,
  });

  return oauth2Client;
}

export function getAuthUrl(): string {
  const oauth2Client = createGoogleOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function getTokensFromCode(code: string) {
  const oauth2Client = createGoogleOAuth2Client();

  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function fetchGoogleCalendarEvents(
  accessToken: string,
  timeMin?: Date,
  timeMax?: Date,
  calendarIds?: string[],
  colorsByCalendarId?: Record<string, string>
): Promise<CalendarEvent[]> {
  try {
    return await fetchGoogleCalendarEventsRest(
      accessToken,
      timeMin,
      timeMax,
      calendarIds,
      colorsByCalendarId
    );
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error);
    throw error;
  }
}

