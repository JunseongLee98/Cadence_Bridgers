import fs from 'fs';
import path from 'path';
import { get, head, put } from '@vercel/blob';
import { normalizeWorkUnit } from '@/lib/decompose-assignment';

export type CompletionDurationSource = 'self_report' | 'scheduled_block' | 'estimate';

export type CompletionTelemetryRecord = {
  schemaVersion: 1 | 2;
  anonymousSessionId: string;
  planId?: string;
  planStepOrder?: number;
  isAiBreakdown: boolean;
  procedureTitle?: string;
  procedureDescription?: string;
  estimatedMinutes?: number;
  actualMinutes: number;
  durationSource: CompletionDurationSource;
  /** AI-inferred measurable quantity (schema v2+). */
  workAmount?: number;
  /** AI-chosen unit label, normalized (schema v2+). */
  workUnit?: string;
  completedAt: string;
  receivedAt: string;
};

export type WorkUnitStats = {
  workUnit: string;
  sampleCount: number;
  meanMinutesPerUnit: number;
  medianMinutesPerUnit: number;
  meanActualMinutes: number;
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

function parseJsonl(text: string): CompletionTelemetryRecord[] {
  const records: CompletionTelemetryRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as CompletionTelemetryRecord);
    } catch {
      // skip corrupt lines
    }
  }
  return records;
}

async function loadRedisRecords(): Promise<CompletionTelemetryRecord[]> {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  const rows = await redis.lrange(REDIS_KEY, 0, -1);
  const records: CompletionTelemetryRecord[] = [];
  for (const row of rows) {
    if (typeof row === 'string') {
      try {
        records.push(JSON.parse(row) as CompletionTelemetryRecord);
      } catch {
        // skip
      }
      continue;
    }
    if (row && typeof row === 'object') {
      records.push(row as CompletionTelemetryRecord);
    }
  }
  return records;
}

function loadFileRecords(): CompletionTelemetryRecord[] {
  const file = localFilePath();
  if (!fs.existsSync(file)) return [];
  return parseJsonl(fs.readFileSync(file, 'utf8'));
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

/** Load all stored completion records (Blob → Redis → local file). */
export async function listCompletionTelemetry(): Promise<CompletionTelemetryRecord[]> {
  assertServerStorageConfigured();
  if (useBlobStore()) {
    return parseJsonl(await loadBlobText());
  }
  if (useRedisStore()) {
    return loadRedisRecords();
  }
  return loadFileRecords();
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Aggregate mean/median minutes-per-unit by workUnit. */
export function aggregateWorkUnitStats(
  records: CompletionTelemetryRecord[]
): WorkUnitStats[] {
  const byUnit = new Map<string, { perUnit: number[]; actual: number[] }>();

  for (const record of records) {
    const unit = normalizeWorkUnit(record.workUnit);
    const amount = record.workAmount;
    if (!unit || amount === undefined || !(amount > 0)) continue;
    if (!Number.isFinite(record.actualMinutes) || record.actualMinutes < 0) continue;

    const perUnit = record.actualMinutes / amount;
    if (!Number.isFinite(perUnit)) continue;

    const bucket = byUnit.get(unit) ?? { perUnit: [], actual: [] };
    bucket.perUnit.push(perUnit);
    bucket.actual.push(record.actualMinutes);
    byUnit.set(unit, bucket);
  }

  const stats: WorkUnitStats[] = [];
  for (const [workUnit, bucket] of byUnit) {
    const perSorted = [...bucket.perUnit].sort((a, b) => a - b);
    const meanMinutesPerUnit =
      bucket.perUnit.reduce((sum, v) => sum + v, 0) / bucket.perUnit.length;
    const meanActualMinutes =
      bucket.actual.reduce((sum, v) => sum + v, 0) / bucket.actual.length;
    stats.push({
      workUnit,
      sampleCount: bucket.perUnit.length,
      meanMinutesPerUnit: Math.round(meanMinutesPerUnit * 100) / 100,
      medianMinutesPerUnit: Math.round(median(perSorted) * 100) / 100,
      meanActualMinutes: Math.round(meanActualMinutes * 100) / 100,
    });
  }

  return stats.sort((a, b) => a.workUnit.localeCompare(b.workUnit));
}
