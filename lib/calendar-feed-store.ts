import fs from 'fs';
import path from 'path';
import { del, get, head, put } from '@vercel/blob';
import type { SerializedFeedEvent } from '@/lib/calendar-feed-events';

export type CalendarFeedRecord = {
  token: string;
  username?: string;
  updatedAt: string;
  events: SerializedFeedEvent[];
};

const DATA_DIR =
  process.env.VERCEL === '1'
    ? path.join('/tmp', 'cadence-calendar-feeds')
    : path.join(process.cwd(), '.data', 'calendar-feeds');
const BLOB_PREFIX = 'cadence-calendar-feeds';
const REDIS_KEY_PREFIX = 'cadence-feed:';

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

/** Vercel: legacy token and/or linked store (OIDC via BLOB_STORE_ID on deploy). */
function useBlobStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function blobObjectAccess(): 'public' | 'private' {
  if (process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return 'private';
  }
  return 'public';
}

function useRedisStore(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
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
    access: blobObjectAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function saveCalendarFeedRedis(record: CalendarFeedRecord): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.set(REDIS_KEY_PREFIX + record.token, record);
}

function parseCalendarFeedRecord(raw: unknown, token: string): CalendarFeedRecord | null {
  const record = raw as CalendarFeedRecord;
  if (!record?.token || record.token !== token || !Array.isArray(record.events)) return null;
  return record;
}

async function loadCalendarFeedBlob(token: string): Promise<CalendarFeedRecord | null> {
  const pathname = blobPathname(token);
  try {
    if (blobObjectAccess() === 'private') {
      const result = await get(pathname, { access: 'private' });
      if (!result?.stream) return null;
      const text = await new Response(result.stream).text();
      return parseCalendarFeedRecord(JSON.parse(text), token);
    }
    const meta = await head(pathname);
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return parseCalendarFeedRecord(await res.json(), token);
  } catch {
    return null;
  }
}

async function loadCalendarFeedRedis(token: string): Promise<CalendarFeedRecord | null> {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = Redis.fromEnv();
    const raw = await redis.get<CalendarFeedRecord>(REDIS_KEY_PREFIX + token);
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

async function deleteCalendarFeedRedis(token: string): Promise<void> {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = Redis.fromEnv();
    await redis.del(REDIS_KEY_PREFIX + token);
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

function assertServerStorageConfigured(): void {
  if (process.env.VERCEL !== '1') return;
  if (useBlobStore() || useRedisStore()) return;
  throw new Error(
    'Calendar feed storage is not configured on Vercel. Connect Vercel Blob (BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN) or Upstash Redis in project Storage settings, then redeploy.'
  );
}

export async function saveCalendarFeed(record: CalendarFeedRecord): Promise<void> {
  assertServerStorageConfigured();
  if (useBlobStore()) {
    await saveCalendarFeedBlob(record);
    return;
  }
  if (useRedisStore()) {
    await saveCalendarFeedRedis(record);
    return;
  }
  saveCalendarFeedFile(record);
}

export async function loadCalendarFeed(token: string): Promise<CalendarFeedRecord | null> {
  if (useBlobStore()) {
    return loadCalendarFeedBlob(token);
  }
  if (useRedisStore()) {
    return loadCalendarFeedRedis(token);
  }
  return loadCalendarFeedFile(token);
}

export async function deleteCalendarFeed(token: string): Promise<void> {
  if (useBlobStore()) {
    await deleteCalendarFeedBlob(token);
    return;
  }
  if (useRedisStore()) {
    await deleteCalendarFeedRedis(token);
    return;
  }
  deleteCalendarFeedFile(token);
}
