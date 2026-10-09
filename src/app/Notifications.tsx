// Glocke oben rechts: Erwähnungen, Kommentare, Zuweisungen, verpasste Anrufe …

import { AtSign, Bell, CheckCheck, MessageSquare, PhoneMissed, UserPlus, Voicemail, Workflow, Mail, MessageCircle, CalendarDays, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatRelative } from '../lib/format.ts';
import type { AppNotification, NotificationKind } from '../lib/types.ts';
import { cx, Popover, useMenu, useUi } from '../ui/ui.tsx';
import { useApp } from './context.tsx';
import { useAsync } from './hooks.ts';
import { leadHref, navigate } from './router.ts';
import { bus } from '../lib/bus.ts';

export const NOTIFICATION_ICONS: Record<NotificationKind, ReactNode> = {
  mention: <AtSign size={16} />,
  comment: <MessageSquare size={16} />,
  assigned: <UserPlus size={16} />,
  missed_call: <PhoneMissed size={16} />,
  voicemail: <Voicemail size={16} />,
  sms: <MessageCircle size={16} />,
  email: <Mail size={16} />,
  meeting: <CalendarDays size={16} />,
  workflow: <Workflow size={16} />,
  system: <Info size={16} />,
};

export function openNotification(n: AppNotification) {
  if (n.ref_kind === 'call' && n.ref_id) navigate(`#/calls/${n.ref_id}`);
  else if (n.lead_id) navigate(leadHref(n.lead_id, 'inbox'));
  else navigate('#/inbox');
}

export function NotificationsBell() {
  const { store, me } = useApp();
  const { toast } = useUi();
  const menu = useMenu();
  const q = useAsync(() => store.listNotifications({ box: 'inbox', limit: 12 }), [store, me.id], ['notifications']);
  const rows = q.data ?? [];
  const unread = rows.filter((n) => !n.read_at).length;

  const markAll = async () => {
    try {
      await store.updateNotifications(rows.filter((n) => !n.read_at).map((n) => n.id), { read: true });
      bus.emit('notifications');
    } catch (e) {
      toast(String(e), { kind: 'error' });
    }
  };

  const open = async (n: AppNotification) => {
    menu.close();
    if (!n.read_at) {
      store.updateNotifications([n.id], { read: true }).then(() => bus.emit('notifications')).catch(() => undefined);
    }
    openNotification(n);
  };

  return (
    <>
      <button
        type="button"
        className={cx('icon-btn bell', unread > 0 && 'has-unread')}
        onClick={menu.open}
        aria-label={unread ? `${unread} neue Benachrichtigungen` : 'Benachrichtigungen'}
        title="Benachrichtigungen"
      >
        <Bell />
        {unread ? <span className="bell-count">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {menu.isOpen ? (
        <Popover anchor={menu.anchor} onClose={menu.close} align="end">
          <div className="notif-pop">
            <div className="row notif-head">
              <strong className="grow">Benachrichtigungen</strong>
              {unread ? (
                <button type="button" className="btn small ghost" onClick={markAll}>
                  <CheckCheck size={15} /> Alle gelesen
                </button>
              ) : null}
            </div>
            {rows.length ? (
              <div className="notif-list">
                {rows.map((n) => (
                  <button key={n.id} type="button" className={cx('notif', !n.read_at && 'unread')} onClick={() => open(n)}>
                    <span className="notif-icon">{NOTIFICATION_ICONS[n.kind]}</span>
                    <span className="grow">
                      <span className="notif-title">{n.title}</span>
                      {n.body ? <span className="notif-body">{n.body}</span> : null}
                      <span className="xs muted">{formatRelative(n.created_at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small" style={{ padding: '12px 14px' }}>Keine neuen Benachrichtigungen.</p>
            )}
            <a className="notif-foot" href="#/inbox" onClick={menu.close}>
              Zur Inbox
            </a>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
