import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DATA_DIR = path.join(process.cwd(), '.data', 'slack-connections');

function cleanupTestRecords(subs: string[]) {
  for (const sub of subs) {
    const file = path.join(DATA_DIR, `${sub.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

describe('slack-store', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('requires blob or redis on Vercel', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    vi.stubEnv('BLOB_STORE_ID', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { saveSlackConnection } = await import('@/lib/slack-store');
    await expect(
      saveSlackConnection({
        googleSub: 'sub-vercel',
        teamId: 'T1',
        accessToken: 'xoxp-1',
        slackUserId: 'U1',
        statusSyncEnabled: true,
        digestEnabled: false,
        updatedAt: new Date().toISOString(),
      })
    ).rejects.toThrow(/not configured on Vercel/);
  });

  it('saves, loads, lists, and deletes on the local file backend', async () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    vi.stubEnv('BLOB_STORE_ID', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const googleSub = `test-slack-${Date.now()}`;
    const { saveSlackConnection, getSlackConnection, listSlackConnections, deleteSlackConnection } =
      await import('@/lib/slack-store');

    try {
      await saveSlackConnection({
        googleSub,
        teamId: 'T1',
        teamName: 'Cadence Dev',
        accessToken: 'xoxp-secret',
        slackUserId: 'U9',
        statusSyncEnabled: true,
        digestEnabled: false,
        calendarFeedToken: 'feed-token-1',
        updatedAt: new Date().toISOString(),
      });

      const loaded = await getSlackConnection(googleSub);
      expect(loaded?.teamName).toBe('Cadence Dev');
      expect(loaded?.accessToken).toBe('xoxp-secret');
      expect(loaded?.calendarFeedToken).toBe('feed-token-1');

      const listed = await listSlackConnections();
      expect(listed.some((r) => r.googleSub === googleSub)).toBe(true);

      await deleteSlackConnection(googleSub);
      expect(await getSlackConnection(googleSub)).toBeNull();
    } finally {
      cleanupTestRecords([googleSub]);
    }
  });
});
