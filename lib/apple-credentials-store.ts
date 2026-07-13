import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { get, head, put, del } from '@vercel/blob';

const DATA_DIR =
  process.env.VERCEL === '1'
    ? path.join('/tmp', 'cadence-apple-credentials')
    : path.join(process.cwd(), '.data', 'apple-credentials');
const BLOB_PREFIX = 'cadence-apple-credentials/';
const REDIS_PREFIX = 'cadence-apple-cred:';

export type AppleCredentialsPlain = {
  appleId: string;
  appSpecificPassword: string;
  createdAt: string;
  updatedAt: string;
};

/** Envelope stored at rest (ciphertext only; no plaintext password). */
type AppleCredentialsEnvelope = {
  v: 1;
  appleId: string;
  iv: string;
  tag: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
};

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

function safeTokenFile(token: string): string {
  return token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function localFilePath(token: string): string {
  return path.join(DATA_DIR, `${safeTokenFile(token)}.json`);
}

function blobPathname(token: string): string {
  return `${BLOB_PREFIX}${safeTokenFile(token)}.json`;
}

function redisKey(token: string): string {
  return `${REDIS_PREFIX}${token}`;
}

function assertServerStorageConfigured(): void {
  if (process.env.VERCEL !== '1') return;
  if (useBlobStore() || useRedisStore()) return;
  throw new Error(
    'Apple credential storage is not configured on Vercel. Connect Vercel Blob or Upstash Redis, then redeploy.'
  );
}

function getEncryptionKey(): Buffer {
  const raw = process.env.APPLE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'APPLE_CREDENTIALS_ENCRYPTION_KEY is not set. Generate a 32-byte base64 key and add it to .env.local.'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'APPLE_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.'
    );
  }
  return key;
}

export function encryptAppSpecificPassword(password: string): {
  iv: string;
  tag: string;
  ciphertext: string;
} {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decryptAppSpecificPassword(parts: {
  iv: string;
  tag: string;
  ciphertext: string;
}): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(parts.iv, 'base64');
  const tag = Buffer.from(parts.tag, 'base64');
  const ciphertext = Buffer.from(parts.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function createAppleConnectionToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function toEnvelope(
  plain: AppleCredentialsPlain,
  encrypted: { iv: string; tag: string; ciphertext: string }
): AppleCredentialsEnvelope {
  return {
    v: 1,
    appleId: plain.appleId,
    iv: encrypted.iv,
    tag: encrypted.tag,
    ciphertext: encrypted.ciphertext,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function fromEnvelope(envelope: AppleCredentialsEnvelope): AppleCredentialsPlain {
  return {
    appleId: envelope.appleId,
    appSpecificPassword: decryptAppSpecificPassword({
      iv: envelope.iv,
      tag: envelope.tag,
      ciphertext: envelope.ciphertext,
    }),
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
  };
}

async function loadBlob(token: string): Promise<AppleCredentialsEnvelope | null> {
  try {
    const pathname = blobPathname(token);
    if (blobObjectAccess() === 'private') {
      const result = await get(pathname, { access: 'private' });
      if (!result?.stream) return null;
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as AppleCredentialsEnvelope;
    }
    const meta = await head(pathname);
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return (await res.json()) as AppleCredentialsEnvelope;
  } catch {
    return null;
  }
}

async function saveBlob(token: string, envelope: AppleCredentialsEnvelope): Promise<void> {
  await put(blobPathname(token), JSON.stringify(envelope), {
    access: blobObjectAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function deleteBlob(token: string): Promise<void> {
  try {
    await del(blobPathname(token));
  } catch {
    // ignore missing
  }
}

async function loadRedis(token: string): Promise<AppleCredentialsEnvelope | null> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  const raw = await redis.get<string | AppleCredentialsEnvelope>(redisKey(token));
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as AppleCredentialsEnvelope;
    } catch {
      return null;
    }
  }
  return raw as AppleCredentialsEnvelope;
}

async function saveRedis(token: string, envelope: AppleCredentialsEnvelope): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.set(redisKey(token), JSON.stringify(envelope));
}

async function deleteRedis(token: string): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.del(redisKey(token));
}

function loadFile(token: string): AppleCredentialsEnvelope | null {
  const file = localFilePath(token);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as AppleCredentialsEnvelope;
  } catch {
    return null;
  }
}

function saveFile(token: string, envelope: AppleCredentialsEnvelope): void {
  ensureDataDir();
  fs.writeFileSync(localFilePath(token), JSON.stringify(envelope), 'utf8');
}

function deleteFile(token: string): void {
  const file = localFilePath(token);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export async function getAppleCredentials(
  connectionToken: string
): Promise<AppleCredentialsPlain | null> {
  assertServerStorageConfigured();
  let envelope: AppleCredentialsEnvelope | null = null;
  if (useBlobStore()) envelope = await loadBlob(connectionToken);
  else if (useRedisStore()) envelope = await loadRedis(connectionToken);
  else envelope = loadFile(connectionToken);
  if (!envelope || envelope.v !== 1) return null;
  return fromEnvelope(envelope);
}

export async function saveAppleCredentials(
  connectionToken: string,
  plain: { appleId: string; appSpecificPassword: string; createdAt?: string }
): Promise<AppleCredentialsPlain> {
  assertServerStorageConfigured();
  const now = new Date().toISOString();
  const full: AppleCredentialsPlain = {
    appleId: plain.appleId.trim(),
    appSpecificPassword: plain.appSpecificPassword.trim(),
    createdAt: plain.createdAt ?? now,
    updatedAt: now,
  };
  const encrypted = encryptAppSpecificPassword(full.appSpecificPassword);
  const envelope = toEnvelope(full, encrypted);

  if (useBlobStore()) {
    await saveBlob(connectionToken, envelope);
  } else if (useRedisStore()) {
    await saveRedis(connectionToken, envelope);
  } else {
    saveFile(connectionToken, envelope);
  }
  return full;
}

export async function deleteAppleCredentials(connectionToken: string): Promise<void> {
  assertServerStorageConfigured();
  if (useBlobStore()) {
    await deleteBlob(connectionToken);
    return;
  }
  if (useRedisStore()) {
    await deleteRedis(connectionToken);
    return;
  }
  deleteFile(connectionToken);
}
