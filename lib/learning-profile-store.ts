import fs from 'fs';
import path from 'path';
import { del, get, head, put } from '@vercel/blob';
import type { LearningProfile } from '@/lib/estimate-calibration';

const DATA_DIR =
  process.env.VERCEL === '1'
    ? path.join('/tmp', 'cadence-learning-profiles')
    : path.join(process.cwd(), '.data', 'learning-profiles');
const BLOB_PREFIX = 'cadence-learning-profiles/';
const REDIS_PREFIX = 'cadence-learning:';

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
    'Learning profile storage is not configured on Vercel. Connect Vercel Blob or Upstash Redis, then redeploy.'
  );
}

async function loadBlob(googleSub: string): Promise<LearningProfile | null> {
  try {
    const pathname = blobPathname(googleSub);
    if (blobObjectAccess() === 'private') {
      const result = await get(pathname, { access: 'private' });
      if (!result?.stream) return null;
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as LearningProfile;
    }
    const meta = await head(pathname);
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return (await res.json()) as LearningProfile;
  } catch {
    return null;
  }
}

async function saveBlob(profile: LearningProfile): Promise<void> {
  await put(blobPathname(profile.googleSub), JSON.stringify(profile), {
    access: blobObjectAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function loadRedis(googleSub: string): Promise<LearningProfile | null> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  const raw = await redis.get<string | LearningProfile>(redisKey(googleSub));
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as LearningProfile;
    } catch {
      return null;
    }
  }
  return raw as LearningProfile;
}

async function saveRedis(profile: LearningProfile): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.set(redisKey(profile.googleSub), JSON.stringify(profile));
}

function loadFile(googleSub: string): LearningProfile | null {
  const file = localFilePath(googleSub);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as LearningProfile;
  } catch {
    return null;
  }
}

function saveFile(profile: LearningProfile): void {
  ensureDataDir();
  fs.writeFileSync(localFilePath(profile.googleSub), JSON.stringify(profile), 'utf8');
}

function deleteFile(googleSub: string): void {
  const file = localFilePath(googleSub);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

async function deleteBlob(googleSub: string): Promise<void> {
  await del(blobPathname(googleSub));
}

async function deleteRedis(googleSub: string): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.del(redisKey(googleSub));
}

export function emptyLearningProfile(
  googleSub: string,
  extras?: { email?: string; displayName?: string }
): LearningProfile {
  return {
    googleSub,
    ...(extras?.email ? { email: extras.email } : {}),
    ...(extras?.displayName ? { displayName: extras.displayName } : {}),
    calibrationByUnit: {},
    sampleCountByUnit: {},
    updatedAt: new Date().toISOString(),
  };
}

export async function getLearningProfile(
  googleSub: string
): Promise<LearningProfile | null> {
  assertServerStorageConfigured();
  if (useBlobStore()) return loadBlob(googleSub);
  if (useRedisStore()) return loadRedis(googleSub);
  return loadFile(googleSub);
}

export async function saveLearningProfile(profile: LearningProfile): Promise<void> {
  assertServerStorageConfigured();
  const next: LearningProfile = {
    ...profile,
    updatedAt: new Date().toISOString(),
  };
  if (useBlobStore()) {
    await saveBlob(next);
    return;
  }
  if (useRedisStore()) {
    await saveRedis(next);
    return;
  }
  saveFile(next);
}

/** Permanently delete a user's stored learning profile (Google sub, email, name, timing history). */
export async function deleteLearningProfile(googleSub: string): Promise<void> {
  assertServerStorageConfigured();
  if (useBlobStore()) {
    await deleteBlob(googleSub);
    return;
  }
  if (useRedisStore()) {
    await deleteRedis(googleSub);
    return;
  }
  deleteFile(googleSub);
}

export async function getOrCreateLearningProfile(
  googleSub: string,
  extras?: { email?: string; displayName?: string }
): Promise<LearningProfile> {
  const existing = await getLearningProfile(googleSub);
  if (existing) {
    let changed = false;
    const merged = { ...existing };
    if (extras?.email && extras.email !== existing.email) {
      merged.email = extras.email;
      changed = true;
    }
    if (extras?.displayName && extras.displayName !== existing.displayName) {
      merged.displayName = extras.displayName;
      changed = true;
    }
    if (changed) await saveLearningProfile(merged);
    return changed ? { ...merged, updatedAt: new Date().toISOString() } : existing;
  }
  const created = emptyLearningProfile(googleSub, extras);
  await saveLearningProfile(created);
  return created;
}
