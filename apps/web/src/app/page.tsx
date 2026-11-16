'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BillingCenter } from './billing-center';
import { CrmCenter } from './crm-center';
import { AuditCenter } from './audit-center';
import { Overview } from './overview';
import { RequestsCenter } from './requests-center';
import { RoomsCenter } from './rooms-center';
import { ReservationsCenter } from './reservations-center';
import { GuestsCenter } from './guests-center';
import { StaffCenter } from './staff-center';
import { OperationsCenter } from './operations-center';
import { useRealtimeNotifications, RealtimeNotification } from './use-realtime-notifications';
import './command-center.css';

type Workspace = {
  user: { name: string; email: string };
  tenant: { id: string; name: string };
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
  { label: 'Rooms', glyph: '▦', live: true },
  { label: 'Guests', glyph: '◎', live: true },
  { label: 'Reservations', glyph: '□', live: true },
  { label: 'Requests', glyph: '↗', live: true },
  { label: 'Housekeeping', glyph: '⌁', live: true },
  { label: 'Maintenance', glyph: '◇', live: true },
  { label: 'Activity', glyph: '◷', adminOnly: true, live: true },
  { label: 'Staff', glyph: '◫', adminOnly: true, live: true },
  { label: 'CRM', glyph: '◌', adminOnly: true, live: true },
  { label: 'Billing', glyph: '$', adminOnly: true, live: true },
  { label: 'Settings', glyph: '⚙', adminOnly: true },
];

export default function Home() {
  const [active, setActive] = useState('Overview');
  const [reservationGuestId, setReservationGuestId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const workspaceRequest = useRef(0);
  const unreadRequest = useRef(0);
  const unreadAbort = useRef<AbortController | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [livePulse, setLivePulse] = useState(false);
  const [toast, setToast] = useState<Notification | null>(null);
  const [focusedRequestId, setFocusedRequestId] = useState<string | null>(null);
  const base = process.env.NEXT_PUBLIC_API_URL ?? '/api';

  const clearWorkspace = useCallback(() => {
    workspaceRequest.current++;
    unreadRequest.current++;
    unreadAbort.current?.abort();
    setWorkspace(null);
    setActive('Overview');
    setReservationGuestId(null);
    setFocusedRequestId(null);
    setNotifications([]);
    setShowNotifications(false);
    setToast(null);
    setWorkspaceLoading(false);
    setWorkspaceError(false);
  }, []);

  const loadWorkspace = useCallback(async (showLoading = true) => {
    const request = ++workspaceRequest.current;
    if (showLoading) setWorkspaceLoading(true);
    setWorkspaceError(false);
    try {
      const response = await fetch(`${base}/auth/me`, { credentials: 'include', cache: 'no-store' });
      if (request !== workspaceRequest.current) return;
      if (response.status === 401) {
        clearWorkspace();
        return;
      }
      if (!response.ok) throw new Error('Workspace unavailable.');
      const data: Workspace = await response.json();
      if (request !== workspaceRequest.current) return;
      setWorkspace(data);
    } catch {
      if (request === workspaceRequest.current) setWorkspaceError(true);
    } finally {
      if (request === workspaceRequest.current) setWorkspaceLoading(false);
    }
  }, [base, clearWorkspace]);

  useEffect(() => {
    void loadWorkspace();
    return () => { workspaceRequest.current++; };
  }, [loadWorkspace]);

  const role = workspace?.membership.role ?? 'UNKNOWN';
  const isHotelAdmin = role === 'HOTEL_ADMIN';
  const isHotelRole = role === 'HOTEL_ADMIN' || role === 'HOTEL_STAFF';
  const scope = isHotelRole && workspace ? workspace.tenant.id + ':' + workspace.user.email + ':' + role : null;

  const refreshUnread = useCallback(async () => {
    if (!scope) return;
    unreadAbort.current?.abort();
    const controller = new AbortController();
    unreadAbort.current = controller;
    const request = ++unreadRequest.current;
    try {
      const response = await fetch(`${base}/notifications/unread`, {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
      });
      if (request !== unreadRequest.current) return;
      if (response.status === 401) { clearWorkspace(); return; }
      if (!response.ok) throw new Error('Unread notifications unavailable.');
      const data: Notification[] = await response.json();
      if (request !== unreadRequest.current) return;
      setNotifications(data);
      setNotificationStatus('ready');
    } catch {
      if (request === unreadRequest.current) setNotificationStatus('error');
    }
  }, [base, clearWorkspace, scope]);

  useEffect(() => {
    setNotifications([]);
    setToast(null);
    setNotificationStatus('loading');
    if (!scope) return;
    void refreshUnread();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUnread();
    }, 15000);
    const onFocus = () => { void loadWorkspace(false); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      unreadRequest.current++;
      unreadAbort.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [loadWorkspace, refreshUnread, scope]);

  const onRealtime = useCallback((event: RealtimeNotification) => {
    if (!event.id) return;
    setToast({ ...event, id: event.id, createdAt: event.createdAt ?? new Date().toISOString(), readAt: null });
    setLivePulse(true);
    void refreshUnread();
  }, [refreshUnread]);

  useEffect(() => {
    if (!livePulse) return;
    const timer = window.setTimeout(() => setLivePulse(false), 1400);
    return () => window.clearTimeout(timer);
  }, [livePulse]);

  useRealtimeNotifications(Boolean(scope) && !workspaceError, onRealtime, refreshUnread);

  const markRead = async (id: string) => {
    const response = await fetch(`${base}/notifications/${id}/read`, { method: 'PATCH', credentials: 'include' });
    if (response.status === 401) { clearWorkspace(); return; }
    if (!response.ok) throw new Error('Unable to mark the notification as read.');
    unreadRequest.current++;
    unreadAbort.current?.abort();
    setNotifications(current => current.filter(notification => notification.id !== id));
    void refreshUnread();
  };

  const logout = async () => {
    setLoggingOut(true);
    setSessionError(null);
    try {
      const response = await fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' });
      if (!response.ok && response.status !== 401) throw new Error('Sign-out failed.');
      clearWorkspace();
      window.location.replace('/onboarding');
    } catch {
      setSessionError('Sign-out could not be verified. Try again.');
    } finally {
      setLoggingOut(false);
    }
  };

  const requestIdFor = (notification: Notification) => {
    if (notification.type !== 'guest_request.created') return null;
    const id = notification.metadata?.requestId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  };
  const openNotification = async (notification: Notification) => {
    const requestId = requestIdFor(notification);
    if (requestId) {
      setFocusedRequestId(requestId);
      setActive('Requests');
    }
    setShowNotifications(false);
    setToast(null);
    try { await markRead(notification.id); } catch { setNotificationStatus('error'); }
  };

  useEffect(() => {
    setActive('Overview');
    setReservationGuestId(null);
    setFocusedRequestId(null);
    setShowNotifications(false);
  }, [scope]);

  const name = workspace?.user.name ?? 'Workspace';
  const hotel = workspace?.tenant.name ?? 'Your hotel';
  const plan = workspace?.subscription?.plan ?? 'NO PLAN';
  useEffect(() => {
    if (isHotelAdmin && new URL(window.location.href).searchParams.has('billing')) setActive('Billing');
  }, [isHotelAdmin]);

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

  if (workspaceError) {
    return <main className="workspace-gate"><div className="gate-panel gate-error" role="alert"><strong>Workspace unavailable</strong><span>Vantara could not reach your authenticated workspace.</span><button className="refresh-button" onClick={() => void loadWorkspace()}>Retry</button></div></main>;
  }

  if (!workspace) {
    return <main className="workspace-gate"><div className="gate-panel"><strong>Sign in to Vantara</strong><span>Open your hotel workspace to continue.</span><a href="/onboarding">Sign in →</a></div></main>;
  }

  if (!isHotelRole) {
    return <main className="workspace-gate"><div className="gate-panel gate-error"><strong>Hotel workspace required</strong><span>This Command Center is restricted to HOTEL_ADMIN and HOTEL_STAFF memberships.</span></div></main>;
  }

  let content = <Overview base={base} onOpenRooms={() => setActive('Rooms')} />;
  if (active === 'Guests') content = <GuestsCenter base={base} canManage={isHotelAdmin} onReserve={guestId => { setReservationGuestId(guestId); setActive('Reservations'); }} />;
  if (active === 'Reservations') content = <ReservationsCenter base={base} canManage={isHotelAdmin} initialGuestId={reservationGuestId} onGuestConsumed={() => setReservationGuestId(null)} />;
  if (active === 'Requests') content = <RequestsCenter focusedRequestId={focusedRequestId} onFocusConsumed={() => setFocusedRequestId(null)} />;
  if (active === 'Rooms') content = <RoomsCenter base={base} canManage={isHotelAdmin} />;
  if (active === 'Billing' && isHotelAdmin) content = <BillingCenter base={base} onState={subscription => setWorkspace(current => current ? { ...current, subscription } : current)} />;
  if (active === 'Activity' && isHotelAdmin) content = <AuditCenter base={base} />;
  if (active === 'Staff' && isHotelAdmin) content = <StaffCenter base={base} />;
  if (active === 'CRM' && isHotelAdmin) content = <CrmCenter base={base} />;
  if (active === 'Housekeeping') content = <OperationsCenter key="housekeeping" base={base} mode="housekeeping" canManage={isHotelRole} />;
  if (active === 'Maintenance') content = <OperationsCenter key="maintenance" base={base} mode="maintenance" canManage={isHotelRole} />;

  return <main className="workspace" key={scope}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">V</span><span>VANTARA</span><small>HOTEL OPERATING SYSTEM</small></div>
      <div className="hotel-card"><div className="eyebrow">Active property</div><div className="hotel-name">{hotel}</div><div className="hotel-meta"><span className="signal-dot" />{plan} · {workspace.subscription?.status ?? 'UNSUBSCRIBED'}</div></div>
      <nav className="nav" aria-label="Hotel modules">
        <div className="nav-label">Workspace</div>{isHotelAdmin && <a className="refresh-button" href="/onboarding">Initial hotel setup →</a>}
        {visibleNav.map((item) => <button key={item.label} aria-current={active === item.label ? 'page' : undefined} className={`${active === item.label ? 'active' : ''} ${!item.live ? 'nav-disabled' : ''}`} onClick={() => item.live && setActive(item.label)} disabled={!item.live} title={!item.live ? `${item.label} module is next in the roadmap` : undefined}><span className="nav-glyph">{item.glyph}</span>{item.label}{item.live && item.label !== 'Overview' && <span className="nav-count">LIVE</span>}{!item.live && <span className="nav-soon">SOON</span>}</button>)}
      </nav>
      <div className="sidebar-footer"><div className="system-line"><span className="signal-dot" /> TENANT CONTEXT ACTIVE</div><div className="user"><div className="avatar">{name.slice(0, 1).toUpperCase()}</div><div><strong>{name}</strong><span>{role}</span></div></div><button className="refresh-button" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? 'Signing out…' : 'Sign out'}</button>{sessionError && <p role="alert">{sessionError}</p>}</div>
    </aside>

    <section className="main">
      <header className="topbar">
        <div><div className="breadcrumb">VANTARA / HOTEL COMMAND CENTER / {active.toUpperCase()}</div><h1>{greeting}, {name.split(' ')[0]}.</h1><p>Live operational view of {hotel}.</p></div>
        <div className="topbar-actions">
          <button className={`notification-button ${livePulse ? 'live-pulse' : ''}`} onClick={() => {
            setShowNotifications(!showNotifications);
            if (!showNotifications) void refreshUnread();
          }} aria-label="Notifications" aria-expanded={showNotifications}>◌{notifications.length > 0 && <b>{notifications.length}</b>}</button>
          {showNotifications && <div className="notification-popover">
            <div className="popover-head"><strong>Notifications</strong>{notificationStatus === 'ready' && <span>{notifications.length} unread</span>}</div>
            {notificationStatus === 'loading' && <div className="empty-notifications" role="status">Loading notifications…</div>}
            {notificationStatus === 'error' && <div className="empty-notifications" role="alert">Unable to sync unread notifications. <button className="refresh-button" onClick={() => void refreshUnread()}>Retry</button></div>}
            {notificationStatus === 'ready' && notifications.length === 0 && <div className="empty-notifications">No unread notifications.</div>}
            {notifications.map(notification => <button className={`notification-item ${notification.severity.toLowerCase()}`} key={notification.id} onClick={() => void openNotification(notification)}><span className="notification-pulse" /><div><strong>{notification.title}</strong><p>{notification.message}</p></div></button>)}
          </div>}
        </div>
      </header>
      {content}
      {toast && <div className="notification-toast" role="status" aria-live="polite">
        <div><strong>{toast.title}</strong><p>{toast.message}</p></div>
        <div className="notification-toast-actions">
          {requestIdFor(toast) && <button onClick={() => void openNotification(toast)}>View request</button>}
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      </div>}
    </section>
  </main>;
}
