import { Bell, CheckCheck, X } from 'lucide-react';
import type { NotificationItem } from '../../../shared/types/index.js';

interface NotificationDrawerProps {
  open: boolean;
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function NotificationDrawer({
  open,
  notifications,
  onClose,
  onMarkRead,
  onMarkAllRead,
}: NotificationDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0A192F]/45 backdrop-blur-xs">
      <div className="w-full max-w-md bg-[#FBFBFA] h-full border-l border-gray-200 flex flex-col shadow-2xl">
        <div className="ad-grad-teal relative overflow-hidden px-6 py-4 text-white flex items-center justify-between">
          <div className="ad-banner-grid absolute inset-0 pointer-events-none opacity-60" />
          <div className="relative z-10 flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-white/15 grid place-items-center">
              <Bell className="w-4 h-4 text-[#A7F3D0]" />
            </span>
            <h3 className="text-base font-bold font-display">Notifications</h3>
          </div>
          <div className="relative z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={onMarkAllRead}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#A7F3D0] hover:text-white px-2.5 py-1 rounded-full bg-white/10 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/15 rounded-full cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No notifications yet. Appointment updates, screening alerts, and follow-ups appear
              here in real time.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read && onMarkRead(n.id)}
                className={`px-6 py-4 transition-colors cursor-pointer ${
                  n.read ? 'bg-white' : 'bg-[#ECFDF5]/80 hover:bg-[#ECFDF5]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
                    {new Date(n.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{n.message}</p>
                <p className="text-[11px] text-slate-400 mt-1.5 uppercase tracking-wider">
                  {n.category} {!n.read ? '· Unread' : ''}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
