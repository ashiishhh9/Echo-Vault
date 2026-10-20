import { Bell, CheckCheck, Clock3, Image, LockKeyhole } from 'lucide-react';
import type { ArchiveNotification } from '../types';
import { PageHeader } from '../components/PageHeader';

const icons = { capsule: LockKeyhole, memory: Image, system: Clock3 };

export function NotificationsPage({ notifications, onRead }: { notifications: ArchiveNotification[]; onRead: () => Promise<void> }) {
  const unread = notifications.filter((item) => !item.read).length;
  return <div className="content notificationsPage"><PageHeader eyebrow={unread ? `${unread} NEW UPDATES` : 'ALL CAUGHT UP'} title="Notifications" description="Small reminders from your private archive." action={unread ? <button className="tag" onClick={onRead}><CheckCheck size={16} />Mark all read</button> : undefined} /><section className="notificationList">{notifications.map((item) => { const Icon = icons[item.kind]; return <article className={`notificationItem${item.read ? '' : ' unread'}`} key={item.id}><div className="notificationIcon"><Icon size={18} /></div><div><h3>{item.title}</h3><p>{item.message}</p><small>{item.time}</small></div>{!item.read && <i aria-label="Unread" />}</article>; })}</section>{!notifications.length && <div className="emptyNotifications"><Bell size={28} /><h3>No notifications yet</h3><p>New capsule activity will appear here.</p></div>}</div>;
}
