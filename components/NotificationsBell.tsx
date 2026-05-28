'use client';

import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import type { InAppNotification } from '@/types';

function formatWhen(d: Date): string {
  try {
    return d.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(d);
  }
}

export default function NotificationsBell({
  notifications,
  open,
  onToggle,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: {
  notifications: InAppNotification[];
  open: boolean;
  onToggle: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}) {
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="relative">
      <div className="header-control-group flex items-center rounded-lg bg-white/10 border border-white/25 overflow-hidden">
        <button
          onClick={onToggle}
          className="h-9 w-9 flex items-center justify-center text-white hover:bg-white/15 transition-colors"
          title="Notifications"
          aria-label="Notifications"
        >
          <span className="relative inline-flex">
            <Bell size={20} />
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-primary-dark text-[11px] font-extrabold flex items-center justify-center border border-white/30">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full z-[200] mt-2 w-[340px] max-w-[calc(100vw-24px)] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-3 py-2.5">
            <div className="font-semibold text-gray-800">Notifications</div>
            <div className="flex items-center gap-1">
              <button
                onClick={onMarkAllRead}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-700"
                title="Mark all as read"
                aria-label="Mark all as read"
              >
                <CheckCheck size={18} />
              </button>
              <button
                onClick={onClearAll}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-700"
                title="Clear all"
                aria-label="Clear all"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>

          <div className="max-h-[min(420px,calc(100vh-8rem))] overflow-y-auto overscroll-contain">
            {notifications.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No notifications yet.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {notifications.map((n) => {
                  const unreadRow = !n.readAt;
                  return (
                    <li
                      key={n.id}
                      className={`cursor-pointer rounded-lg px-3 py-3 transition-colors ${
                        unreadRow
                          ? 'bg-amber-50/60 hover:bg-amber-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]'
                          : 'hover:bg-gray-50 dark:hover:bg-white/[0.06]'
                      }`}
                      onClick={() => onMarkRead(n.id)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-800 truncate">
                            {n.title}
                          </div>
                          {n.body && (
                            <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                              {n.body}
                            </div>
                          )}
                          <div className="text-[11px] text-gray-500 mt-1">
                            {formatWhen(n.createdAt)}
                          </div>
                        </div>
                        {unreadRow && (
                          <span className="mt-1 h-2 w-2 rounded-full bg-amber-500 flex-shrink-0" />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
