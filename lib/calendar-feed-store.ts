import fs from 'fs';
import path from 'path';
import { del, head, put } from '@vercel/blob';
import type { SerializedFeedEvent } from '@/lib/calendar-feed-events';

export type CalendarFeedRecord = {
  token: string;
  username?: string;
  updatedAt: string;
  events: SerializedFeedEvent[];
};

const DATA_DIR = path.join(process.cwd(), '.data', 'calendar-feeds');
const BLOB_PREFIX = 'cadence-calendar-feeds';

function assertValidToken(token: string): void {
  const safe = token.replace(/[^a-zA-Z0-9-]/g, '');
  if (!safe || safe !== token) {
    throw new Error('Invalid feed token');
  }
}

function feedPath(token: string): string {
  assertValidToken(token);
  return path.join(DATA_DIR, `${token}.json`);
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function useBlobStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function blobPathname(token: string): string {
  assertValidToken(token);
  return `${BLOB_PREFIX}/${token}.json`;
}

function saveCalendarFeedFile(record: CalendarFeedRecord): void {
  ensureDataDir();
  fs.writeFileSync(feedPath(record.token), JSON.stringify(record), 'utf8');
}

async function saveCalendarFeedBlob(record: CalendarFeedRecord): Promise<void> {
  await put(blobPathname(record.token), JSON.stringify(record), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function loadCalendarFeedBlob(token: string): Promise<CalendarFeedRecord | null> {
  try {
    const meta = await head(blobPathname(token));
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    const raw = (await res.json()) as CalendarFeedRecord;
    if (!raw?.token || raw.token !== token || !Array.isArray(raw.events)) return null;
    return raw;
  } catch {
    return null;
  }
}

function loadCalendarFeedFile(token: string): CalendarFeedRecord | null {
  try {
    const file = feedPath(token);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as CalendarFeedRecord;
    if (!raw?.token || raw.token !== token || !Array.isArray(raw.events)) return null;
    return raw;
  } catch {
    return null;
  }
}

async function deleteCalendarFeedBlob(token: string): Promise<void> {
  try {
    await del(blobPathname(token));
  } catch {
    // ignore
  }
}

function deleteCalendarFeedFile(token: string): void {
  try {
    const file = feedPath(token);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

export async function saveCalendarFeed(record: CalendarFeedRecord): Promise<void> {
  if (useBlobStore()) {
    await saveCalendarFeedBlob(record);
    return;
  }
  saveCalendarFeedFile(record);
}

export async function loadCalendarFeed(token: string): Promise<CalendarFeedRecord | null> {
  if (useBlobStore()) {
    return loadCalendarFeedBlob(token);
  }
  return loadCalendarFeedFile(token);
}

export async function deleteCalendarFeed(token: string): Promise<void> {
  if (useBlobStore()) {
    await deleteCalendarFeedBlob(token);
    return;
  }
  deleteCalendarFeedFile(token);
}
