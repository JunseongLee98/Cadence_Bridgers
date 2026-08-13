import fs from 'fs';
import path from 'path';
import { del, get, head, list, put } from '@vercel/blob';
import type { SlackConnection } from '@/types';

export type SlackStoreRecord = SlackConnection & {
  googleSub: string;
  calendarFeedToken?: string;
  botAccessToken?: string;
  timeZone?: string;
  updatedAt: string;
  lastStatusEventId?: string | null;
  lastDigestDate?: string | null;
  remindedEventIds?: string[];
};

const DATA_DIR =
  process.env.VERCEL === '1'
    ? path.join('/tmp', 'cadence-slack-connections')
    : path.join(process.cwd(), '.data', 'slack-connections');
const BLOB_PREFIX = 'cadence-slack-connections/';
const REDIS_PREFIX = 'cadence-slack:';
const REDIS_INDEX_KEY = 'cadence-slack:index';
const INDEX_BLOB = `${BLOB_PREFIX}_index.json`;

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

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function safeSubFile(googleSub: string): string {
  return googleSub.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function localFilePath(googleSub: string): string {
  return path.join(DATA_DIR, `${safeSubFile(googleSub)}.json`);
}

function blobPathname(googleSub: string): string {
  return `${BLOB_PREFIX}${safeSubFile(googleSub)}.json`;
}

function redisKey(googleSub: string): string {
  return `${REDIS_PREFIX}${googleSub}`;
}

function assertServerStorageConfigured(): void {
  if (process.env.VERCEL !== '1') return;
  if (useBlobStore() || useRedisStore()) return;
  throw new Error(
    'Slack connection storage is not configured on Vercel. Connect Vercel Blob or Upstash Redis, then redeploy.'
  );
}

function parseRecord(raw: unknown): SlackStoreRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<SlackStoreRecord>;
  if (typeof row.googleSub !== 'string' || !row.googleSub.trim()) return null;
  if (typeof row.teamId !== 'string' || typeof row.accessToken !== 'string') return null;
  if (typeof row.slackUserId !== 'string') return null;
  return {
    googleSub: row.googleSub,
    teamId: row.teamId,
    ...(typeof row.teamName === 'string' ? { teamName: row.teamName } : {}),
    accessToken: row.accessToken,
    slackUserId: row.slackUserId,
    statusSyncEnabled: row.statusSyncEnabled !== false,
    digestEnabled: row.digestEnabled === true,
    ...(typeof row.reminderMinutesBefore === 'number'
      ? { reminderMinutesBefore: row.reminderMinutesBefore }
      : {}),
    ...(typeof row.calendarFeedToken === 'string'
      ? { calendarFeedToken: row.calendarFeedToken }
      : {}),
    ...(typeof row.botAccessToken === 'string' ? { botAccessToken: row.botAccessToken } : {}),
    ...(typeof row.timeZone === 'string' ? { timeZone: row.timeZone } : {}),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    lastStatusEventId:
      row.lastStatusEventId === null || typeof row.lastStatusEventId === 'string'
        ? row.lastStatusEventId
        : undefined,
    lastDigestDate:
      row.lastDigestDate === null || typeof row.lastDigestDate === 'string'
        ? row.lastDigestDate
        : undefined,
    ...(Array.isArray(row.remindedEventIds)
      ? { remindedEventIds: row.remindedEventIds.filter((id) => typeof id === 'string') }
      : {}),
  };
}

async function loadBlob(googleSub: string): Promise<SlackStoreRecord | null> {
  try {
    const pathname = blobPathname(googleSub);
    if (blobObjectAccess() === 'private') {
      const result = await get(pathname, { access: 'private' });
      if (!result?.stream) return null;
      const text = await new Response(result.stream).text();
      return parseRecord(JSON.parse(text));
    }
    const meta = await head(pathname);
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return parseRecord(await res.json());
  } catch {
    return null;
  }
}

async function saveBlob(record: SlackStoreRecord): Promise<void> {
  await put(blobPathname(record.googleSub), JSON.stringify(record), {
    access: blobObjectAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function deleteBlob(googleSub: string): Promise<void> {
  try {
    await del(blobPathname(googleSub));
  } catch {
    // ignore
  }
}

async function loadBlobIndex(): Promise<string[]> {
  try {
    if (blobObjectAccess() === 'private') {
      const result = await get(INDEX_BLOB, { access: 'private' });
      if (!result?.stream) return [];
      const text = await new Response(result.stream).text();
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
    }
    const meta = await head(INDEX_BLOB);
    const res = await fetch(meta.url);
    if (!res.ok) return [];
    const parsed = await res.json();
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

async function saveBlobIndex(subs: string[]): Promise<void> {
  await put(INDEX_BLOB, JSON.stringify(Array.from(new Set(subs))), {
    access: blobObjectAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function listBlobRecords(): Promise<SlackStoreRecord[]> {
  const fromIndex = await loadBlobIndex();
  let subs = fromIndex;
  if (subs.length === 0) {
    try {
      const listed: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: BLOB_PREFIX, cursor });
        for (const blob of page.blobs) {
          const name = blob.pathname.replace(BLOB_PREFIX, '');
          if (!name.endsWith('.json') || name === '_index.json') continue;
          listed.push(name.slice(0, -'.json'.length));
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      subs = listed;
    } catch {
      subs = [];
    }
  }
  const records: SlackStoreRecord[] = [];
  for (const sub of subs) {
    const record = await loadBlob(sub);
    if (record) records.push(record);
  }
  return records;
}

async function loadRedis(googleSub: string): Promise<SlackStoreRecord | null> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  const raw = await redis.get<string | SlackStoreRecord>(redisKey(googleSub));
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return parseRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return parseRecord(raw);
}

async function saveRedis(record: SlackStoreRecord): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.set(redisKey(record.googleSub), JSON.stringify(record));
  await redis.sadd(REDIS_INDEX_KEY, record.googleSub);
}

async function deleteRedis(googleSub: string): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.del(redisKey(googleSub));
  await redis.srem(REDIS_INDEX_KEY, googleSub);
}

async function listRedisRecords(): Promise<SlackStoreRecord[]> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  const subs = (await redis.smembers(REDIS_INDEX_KEY)) as string[];
  const records: SlackStoreRecord[] = [];
  for (const sub of subs ?? []) {
    const record = await loadRedis(sub);
    if (record) records.push(record);
  }
  return records;
}

function loadFile(googleSub: string): SlackStoreRecord | null {
  const file = localFilePath(googleSub);
  if (!fs.existsSync(file)) return null;
  try {
    return parseRecord(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

function saveFile(record: SlackStoreRecord): void {
  ensureDataDir();
  fs.writeFileSync(localFilePath(record.googleSub), JSON.stringify(record), 'utf8');
}

function deleteFile(googleSub: string): void {
  try {
    const file = localFilePath(googleSub);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

function listFileRecords(): SlackStoreRecord[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const records: SlackStoreRecord[] = [];
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    try {
      const parsed = parseRecord(
        JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'))
      );
      if (parsed) records.push(parsed);
    } catch {
      // skip
    }
  }
  return records;
}

export async function getSlackConnection(
  googleSub: string
): Promise<SlackStoreRecord | null> {
  assertServerStorageConfigured();
  if (useBlobStore()) return loadBlob(googleSub);
  if (useRedisStore()) return loadRedis(googleSub);
  return loadFile(googleSub);
}

export async function saveSlackConnection(record: SlackStoreRecord): Promise<void> {
  assertServerStorageConfigured();
  const next: SlackStoreRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };
  if (useBlobStore()) {
    await saveBlob(next);
    const index = await loadBlobIndex();
    if (!index.includes(next.googleSub)) {
      await saveBlobIndex([...index, next.googleSub]);
    }
    return;
  }
  if (useRedisStore()) {
    await saveRedis(next);
    return;
  }
  saveFile(next);
}

export async function deleteSlackConnection(googleSub: string): Promise<void> {
  assertServerStorageConfigured();
  if (useBlobStore()) {
    await deleteBlob(googleSub);
    const index = (await loadBlobIndex()).filter((s) => s !== googleSub);
    await saveBlobIndex(index);
    return;
  }
  if (useRedisStore()) {
    await deleteRedis(googleSub);
    return;
  }
  deleteFile(googleSub);
}

/** Every user who has Slack connected — used by the cron tick. */
export async function listSlackConnections(): Promise<SlackStoreRecord[]> {
  assertServerStorageConfigured();
  if (useBlobStore()) return listBlobRecords();
  if (useRedisStore()) return listRedisRecords();
  return listFileRecords();
}

export function toPublicSlackConnection(record: SlackStoreRecord): {
  connected: true;
  teamName?: string;
  slackUserId: string;
  statusSyncEnabled: boolean;
  digestEnabled: boolean;
  reminderMinutesBefore?: number;
} {
  return {
    connected: true,
    ...(record.teamName ? { teamName: record.teamName } : {}),
    slackUserId: record.slackUserId,
    statusSyncEnabled: record.statusSyncEnabled,
    digestEnabled: record.digestEnabled,
    ...(typeof record.reminderMinutesBefore === 'number'
      ? { reminderMinutesBefore: record.reminderMinutesBefore }
      : {}),
  };
}
