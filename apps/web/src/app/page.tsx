'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Overview } from './overview';
import { RequestsCenter } from './requests-center';
import { useRealtimeNotifications, RealtimeNotification } from './use-realtime-notifications';
import './command-center.css';

type Workspace = {
  user: { name: string; email: string };
  tenant: { name: string };
  membership: { role: string };
  subscription: { plan: string; status: string } | null;
};

type Notification = RealtimeNotification & { id: string; createdAt: string; readAt: string | null };

type NavItem = {
  label: string;
  glyph: string;
  live?: boolean;
  adminOnly?: boolean;
};

const nav: NavItem[] = [
  { label: 'Overview', glyph: '◈', live: true },
  { label: 'Rooms', glyph: '▦' },
  { label: 'Guests', glyph: '◎' },
  { label: 'Reservations', glyph: '□' },
  { label: 'Requests', glyph: '↗', live: true },
  { label: 'Housekeeping', glyph: '⌁' },
  { label: 'Maintenance', glyph: '◇' },
  { label: 'Staff', glyph: '◫', adminOnly: true },
  { label: 'CRM', glyph: '◌', adminOnly: true },
  { label: 'Finance', glyph: '$', adminOnly: true },
  { label: 'Settings', glyph: '⚙', adminOnly: true },
];

export default function Home() {
  const [active, setActive] = useState('Overview');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [livePulse, setLivePulse] = useState(false);
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  useEffect(() => {
    setWorkspaceLoading(true);
    fetch(`${base}/auth/me`, { credentials: 'include' })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => {
        setWorkspace(data);
        setWorkspaceError(false);
      })
      .catch(() => setWorkspaceError(true))
      .finally(() => setWorkspaceLoading(false));

    fetch(`${base}/notifications/unread`, { credentials: 'include' })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => Array.isArray(data) && setNotifications(data))
      .catch(() => undefined);
  }, [base]);

  const onRealtime = useCallback((event: RealtimeNotification) => {
    if (!event.id) return;
    const notification = {
      ...event,
      id: event.id,
      createdAt: event.createdAt ?? new Date().toISOString(),
      readAt: null,
    };
    setNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 50));
    setLivePulse(true);
    window.setTimeout(() => setLivePulse(false), 1400);
  }, []);

  useRealtimeNotifications(onRealtime);

  const markRead = async (id: string) => {
    const response = await fetch(`${base}/notifications/${id}/read`, { method: 'PATCH', credentials: 'include' });
    if (response.ok) setNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  const name = workspace?.user.name ?? 'Workspace';
  const hotel = workspace?.tenant.name ?? 'Your hotel';
  const role = workspace?.membership.role ?? 'UNKNOWN';
  const plan = workspace?.subscription?.plan ?? 'NO PLAN';
  const isHotelAdmin = role === 'HOTEL_ADMIN';
  const isHotelRole = role === 'HOTEL_ADMIN' || role === 'HOTEL_STAFF';

  const visibleNav = useMemo(
    () => nav.filter((item) => !item.adminOnly || isHotelAdmin),
    [isHotelAdmin],
  );

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }, []);

  if (workspaceLoading) {
    return <main className="workspace-gate"><div className="gate-panel"><span className="state-signal" /><strong>Opening Hotel Command Center</strong><span>Resolving authenticated workspace and tenant context...</span></div></main>;
  }

  if (workspaceError || !workspace) {
    return <main className="workspace-gate"><div className="gate-panel gate-error"><strong>Workspace unavailable</strong><span>Vantara could not resolve an authenticated hotel workspace.</span></div></main>;
  }

  if (!isHotelRole) {
    return <main className="workspace-gate"><div className="gate-panel gate-error"><strong>Hotel workspace required</strong><span>This Command Center is restricted to HOTEL_ADMIN and HOTEL_STAFF memberships.</span></div></main>;
  }

  return <main className="workspace">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">V</span><span>VANTARA</span><small>HOTEL OPERATING SYSTEM</small></div>
      <div className="hotel-card"><div className="eyebrow">Active property</div><div className="hotel-name">{hotel}</div><div className="hotel-meta"><span className="signal-dot" />{plan} · {workspace.subscription?.status ?? 'UNSUBSCRIBED'}</div></div>
      <nav className="nav">
        <div className="nav-label">Workspace</div>
        {visibleNav.map((item) => <button key={item.label} className={`${active === item.label ? 'active' : ''} ${!item.live ? 'nav-disabled' : ''}`} onClick={() => item.live && setActive(item.label)} disabled={!item.live} title={!item.live ? `${item.label} module is next in the roadmap` : undefined}><span className="nav-glyph">{item.glyph}</span>{item.label}{item.label === 'Requests' && <span className="nav-count">LIVE</span>}{!item.live && <span className="nav-soon">SOON</span>}</button>)}
      </nav>
      <div className="sidebar-footer"><div className="system-line"><span className="signal-dot" /> TENANT CONTEXT ACTIVE</div><div className="user"><div className="avatar">{name.slice(0, 1).toUpperCase()}</div><div><strong>{name}</strong><span>{role}</span></div></div></div>
    </aside>

    <section className="main">
      <header className="topbar">
        <div><div className="breadcrumb">VANTARA / HOTEL COMMAND CENTER / {active.toUpperCase()}</div><h1>{greeting}, {name.split(' ')[0]}.</h1><p>Live operational view of {hotel}.</p></div>
        <div className="topbar-actions"><div className="environment live-environment"><span /> LIVE TENANT</div><button className={`notification-button ${livePulse ? 'live-pulse' : ''}`} onClick={() => setShowNotifications(!showNotifications)} aria-label="Notifications">◌{notifications.length > 0 && <b>{notifications.length}</b>}</button>{showNotifications && <div className="notification-popover"><div className="popover-head"><strong>Notifications</strong><span>{notifications.length} unread</span></div>{notifications.length === 0 ? <div className="empty-notifications">No unread notifications.</div> : notifications.slice(0, 5).map((notification) => <button className={`notification-item ${notification.severity.toLowerCase()}`} key={notification.id} onClick={() => markRead(notification.id)}><span className="notification-pulse" /><div><strong>{notification.title}</strong><p>{notification.message}</p></div></button>)}</div>}</div>
      </header>

      {active === 'Requests' ? <RequestsCenter /> : <Overview base={base} />}
    </section>
  </main>;
}
