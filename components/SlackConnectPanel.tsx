'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export type SlackPublicConnection = {
  connected: boolean;
  teamName?: string;
  slackUserId?: string;
  statusSyncEnabled?: boolean;
  digestEnabled?: boolean;
  reminderMinutesBefore?: number;
};

type SlackConnectPanelProps = {
  googleSub: string | null;
  calendarFeedToken: string | null;
  notice?: string | null;
};

export default function SlackConnectPanel({
  googleSub,
  calendarFeedToken,
  notice,
}: SlackConnectPanelProps) {
  const { m, t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<SlackPublicConnection>({ connected: false });

  const timeZone =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  const loadConnection = useCallback(async () => {
    if (!googleSub) {
      setConnection({ connected: false });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/slack/connection?googleSub=${encodeURIComponent(googleSub)}`
      );
      const data = (await res.json()) as SlackPublicConnection & { error?: string };
      if (!res.ok) {
        setError(data.error || m.settings.slack.saveFailed);
        return;
      }
      setConnection(data.connected ? data : { connected: false });
    } catch {
      setError(m.settings.slack.saveFailed);
    } finally {
      setLoading(false);
    }
  }, [googleSub, m.settings.slack.saveFailed]);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  const handleConnect = async () => {
    if (!googleSub) return;
    try {
      const params = new URLSearchParams({ googleSub });
      if (calendarFeedToken) params.set('feedToken', calendarFeedToken);
      if (timeZone) params.set('timeZone', timeZone);
      const res = await fetch(`/api/slack/auth?${params.toString()}`);
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (!res.ok || !data.authUrl) {
        alert(data.error || m.settings.slack.oauthFailed);
        return;
      }
      window.location.href = data.authUrl;
    } catch {
      alert(m.settings.slack.oauthFailed);
    }
  };

  const handleDisconnect = async () => {
    if (!googleSub) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/slack/connection', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleSub }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || m.settings.slack.saveFailed);
        return;
      }
      setConnection({ connected: false });
    } catch {
      setError(m.settings.slack.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const patchSettings = async (patch: Record<string, unknown>) => {
    if (!googleSub) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/slack/connection', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleSub,
          ...(calendarFeedToken ? { calendarFeedToken } : {}),
          ...(timeZone ? { timeZone } : {}),
          ...patch,
        }),
      });
      const data = (await res.json()) as SlackPublicConnection & { error?: string };
      if (!res.ok) {
        setError(data.error || m.settings.slack.saveFailed);
        return;
      }
      setConnection(data);
    } catch {
      setError(m.settings.slack.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <MessageSquare size={16} />
        {m.settings.slack.title}
      </h4>
      <p className="text-xs text-gray-500 mb-3">{m.settings.slack.connectHelp}</p>
      <div className="space-y-2 rounded-lg border border-gray-200 p-3">
        {!googleSub ? (
          <p className="text-xs text-gray-500">{m.settings.slack.needsGoogle}</p>
        ) : (
          <>
            {notice && <p className="text-xs text-primary-700">{notice}</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}
            {!connection.connected ? (
              <button
                type="button"
                disabled={loading || saving}
                onClick={() => void handleConnect()}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
              >
                <MessageSquare size={13} />
                {m.settings.slack.connect}
              </button>
            ) : (
              <>
                <p className="text-xs text-gray-700">
                  {connection.teamName
                    ? t('settings.slack.connected', { team: connection.teamName })
                    : m.settings.slack.connectedFallback}
                </p>
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700">
                  <span>
                    {m.settings.slack.statusSync}
                    <span className="block text-xs text-gray-500 font-normal">
                      {m.settings.slack.statusSyncHint}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={saving}
                    checked={connection.statusSyncEnabled !== false}
                    onChange={(e) =>
                      void patchSettings({ statusSyncEnabled: e.target.checked })
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700">
                  <span>
                    {m.settings.slack.digest}
                    <span className="block text-xs text-gray-500 font-normal">
                      {m.settings.slack.digestHint}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={saving}
                    checked={connection.digestEnabled === true}
                    onChange={(e) => void patchSettings({ digestEnabled: e.target.checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700">
                  <span>
                    {m.settings.slack.reminders}
                    <span className="block text-xs text-gray-500 font-normal">
                      {m.settings.slack.remindersHint}
                    </span>
                  </span>
                  <select
                    className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white"
                    disabled={saving}
                    value={
                      typeof connection.reminderMinutesBefore === 'number'
                        ? String(connection.reminderMinutesBefore)
                        : ''
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      void patchSettings({
                        reminderMinutesBefore: value ? Number(value) : null,
                      });
                    }}
                  >
                    <option value="">{m.settings.slack.remindersOff}</option>
                    <option value="10">10 {m.common.minutes}</option>
                    <option value="15">15 {m.common.minutes}</option>
                    <option value="30">30 {m.common.minutes}</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDisconnect()}
                  className="text-[11px] text-gray-500 underline hover:no-underline disabled:opacity-60"
                >
                  {m.settings.slack.disconnect}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
