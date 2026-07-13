import fs from 'fs';
import path from 'path';
import { get, head, put } from '@vercel/blob';

export type CompletionDurationSource = 'self_report' | 'scheduled_block' | 'estimate';

export type CompletionTelemetryRecord = {
  schemaVersion: 1;
  anonymousSessionId: string;
  planId?: string;
  planStepOrder?: number;
  isAiBreakdown: boolean;
  procedureTitle?: string;
  procedureDescription?: string;
  estimatedMinutes?: number;
  actualMinutes: number;
  durationSource: CompletionDurationSource;
  completedAt: string;
  receivedAt: string;
};

const DATA_DIR =
  process.env.VERCEL === '1'
    ? path.join('/tmp', 'cadence-completion-telemetry')
    : path.join(process.cwd(), '.data', 'completion-telemetry');
const BLOB_PATHNAME = 'cadence-completion-telemetry/completions.jsonl';
const REDIS_KEY = 'cadence-completions';

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

function localFilePath(): string {
  return path.join(DATA_DIR, 'completions.jsonl');
}

async function loadBlobText(): Promise<string> {
  try {
    if (blobObjectAccess() === 'private') {
      const result = await get(BLOB_PATHNAME, { access: 'private' });
      if (!result?.stream) return '';
      return await new Response(result.stream).text();
    }
    const meta = await head(BLOB_PATHNAME);
    const res = await fetch(meta.url);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function appendBlob(record: CompletionTelemetryRecord): Promise<void> {
  const existing = await loadBlobText();
  const next = `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${JSON.stringify(record)}\n`;
  await put(BLOB_PATHNAME, next, {
    access: blobObjectAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/x-ndjson',
  });
}

async function appendRedis(record: CompletionTelemetryRecord): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.rpush(REDIS_KEY, JSON.stringify(record));
}

function appendFile(record: CompletionTelemetryRecord): void {
  ensureDataDir();
  fs.appendFileSync(localFilePath(), `${JSON.stringify(record)}\n`, 'utf8');
}

function assertServerStorageConfigured(): void {
  if (process.env.VERCEL !== '1') return;
  if (useBlobStore() || useRedisStore()) return;
  throw new Error(
    'Completion telemetry storage is not configured on Vercel. Connect Vercel Blob or Upstash Redis, then redeploy.'
  );
}

/** Append one anonymous completion record. */
export async function appendCompletionTelemetry(
  record: CompletionTelemetryRecord
): Promise<void> {
  assertServerStorageConfigured();
  if (useBlobStore()) {
    await appendBlob(record);
    return;
  }
  if (useRedisStore()) {
    await appendRedis(record);
    return;
  }
  appendFile(record);
}
