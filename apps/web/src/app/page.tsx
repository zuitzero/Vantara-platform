'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRealtimeNotifications, RealtimeNotification } from './use-realtime-notifications';

type Workspace = {
  user: { name: string; email: string };
  tenant: { name: string };
  membership: { role: string };
  subscription: { plan: string; status: string } | null;
};

type Notification = RealtimeNotification & {
  id: string;
  createdAt: string;
  readAt: string | null;
};

const nav = [
  { label: 'Overview', glyph: '◈' },
  { label: 'Rooms', glyph: '▦' },
  { label: 'Guests', glyph: '◎' },
  { label: 'Reservations', glyph: '□' },
  { label: 'Requests', glyph: '↗' },
  { label: 'Staff', glyph: '◇' },
  { label: 'Finance', glyph: '$' },
  { label: 'Settings', glyph: '⚙' },
];

const demoMetrics = [
  ['Occupancy', '82.4%', '+5.7%'],
  ['Revenue', '$428,650', '+12.8%'],
  ['Reservations', '486', '+8.4%'],
  ['Open requests', '07', '-18.2%'],
];

const demoBars = [38, 54, 47, 66, 58, 72, 64, 81, 69, 88, 76, 94, 84, 91];

export default function Home() {
  const [active, setActive] = useState('Overview');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [livePulse, setLivePulse] = useState(false);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

    fetch(`${base}/auth/me`, { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data && setWorkspace(data))
      .catch(() => undefined);

    fetch(`${base}/notifications/unread`, { credentials: 'include' })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => Array.isArray(data) && setNotifications(data))
      .catch(() => undefined);
  }, []);

  const handleRealtimeNotification = useCallback((event: RealtimeNotification) => {
    if (!event.id) return;

    const notification: Notification = {
      ...event,
      id: event.id,
      createdAt: event.createdAt ?? new Date().toISOString(),
      readAt: null,
    };

    setNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 50));
    setLivePulse(true);
    window.setTimeout(() => setLivePulse(false), 1400);
  }, []);

  useRealtimeNotifications(handleRealtimeNotification);

  const markRead = async (notificationId: string) => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${base}/notifications/${notificationId}/read`, {
      method: 'PATCH',
      credentials: 'include',
    });

    if (response.ok) {
      setNotifications((current) => current.filter((item) => item.id !== notificationId));
    }
  };

  const name = workspace?.user.name ?? 'Workspace';
  const hotel = workspace?.tenant.name ?? 'Your hotel';
  const role = workspace?.membership.role ?? 'DEMO';
  const plan = workspace?.subscription?.plan ?? 'DEMO';
  const unreadCount = notifications.length;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>VANTARA</span>
          <small>HOTEL OPERATING SYSTEM</small>
        </div>

        <div className="hotel-card">
          <div className="eyebrow">Active property</div>
          <div className="hotel-name">{hotel}</div>
          <div className="hotel-meta">
            <span className="signal-dot" />
            {plan} · {workspace?.subscription?.status ?? 'PREVIEW'}
          </div>
        </div>

        <nav className="nav" aria-label="Workspace navigation">
          <div className="nav-label">Workspace</div>
          {nav.map((item) => (
            <button
              key={item.label}
              className={active === item.label ? 'active' : ''}
              onClick={() => setActive(item.label)}
            >
              <span className="nav-glyph">{item.glyph}</span>
              {item.label}
              {item.label === 'Requests' && <span className="nav-count">07</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="system-line"><span className="signal-dot" /> SYSTEM ONLINE</div>
          <div className="user">
            <div className="avatar">{name.slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{name}</strong>
              <span>{role}</span>
            </div>
          </div>
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <div className="breadcrumb">VANTARA / {active.toUpperCase()}</div>
            <h1>{greeting}, {name.split(' ')[0]}.</h1>
            <p>One operational view of {hotel}.</p>
          </div>

          <div className="topbar-actions">
            <div className="environment"><span /> DEMO ENVIRONMENT</div>
            <button className={`notification-button ${livePulse ? 'live-pulse' : ''}`} onClick={() => setShowNotifications(!showNotifications)} aria-label="Notifications">
              ◌
              {unreadCount > 0 && <b>{unreadCount}</b>}
            </button>
            {showNotifications && (
              <div className="notification-popover">
                <div className="popover-head">
                  <strong>Notifications</strong>
                  <span>{unreadCount} unread</span>
                </div>
                {notifications.length === 0 ? (
                  <div className="empty-notifications">No unread notifications.</div>
                ) : (
                  notifications.slice(0, 5).map((notification) => (
                    <button className={`notification-item ${notification.severity.toLowerCase()}`} key={notification.id} onClick={() => markRead(notification.id)}>
                      <span className="notification-pulse" />
                      <div>
                        <strong>{notification.title}</strong>
                        <p>{notification.message}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </header>

        <div className="preview-banner">
          <span className="preview-icon">◈</span>
          <div>
            <strong>Workspace preview</strong>
            <span>Operational metrics below are demonstration data. Vantara will replace them with source-of-truth hotel data as modules go live.</span>
          </div>
        </div>

        <section className="metrics" aria-label="Hotel performance preview">
          {demoMetrics.map(([label, value, change]) => (
            <div className="metric-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{change} vs previous period</small>
            </div>
          ))}
        </section>

        <section className="grid">
          <div className="panel chart-panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Performance</span>
                <h2>Revenue & occupancy</h2>
              </div>
              <span className="panel-meta">14 day preview · MXN</span>
            </div>
            <div className="chart">
              {demoBars.map((height, index) => (
                <div className="bar-wrap" key={index}>
                  <div className="bar" style={{ height: `${height}%` }} />
                </div>
              ))}
            </div>
            <div className="chart-axis"><span>14 days ago</span><span>Today</span></div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Today</span>
                <h2>Hotel pulse</h2>
              </div>
              <span className="live-label"><i /> REALTIME</span>
            </div>
            <Pulse label="Check-ins" detail="Expected arrivals" value="24" />
            <Pulse label="Check-outs" detail="Departures" value="17" />
            <Pulse label="Rooms cleaning" detail="Housekeeping queue" value="08" />
            <Pulse label="Open requests" detail="Guest operations" value="07" />
          </div>
        </section>

        <section className="grid lower">
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Guest communication</span>
                <h2>Recent requests</h2>
              </div>
              <button className="text-button" onClick={() => setActive('Requests')}>Open queue ↗</button>
            </div>
            <Request title="Extra towels · Room 407" detail="Housekeeping · 4 min ago" status="OPEN" />
            <Request title="AC inspection · Room 214" detail="Maintenance · 11 min ago" status="ASSIGNED" />
            <Request title="Room service · Room 508" detail="Food & beverage · 18 min ago" status="IN PROGRESS" />
          </div>

          <div className="panel intelligence">
            <div className="intel-orbit"><span /><span /><span /></div>
            <span className="panel-kicker">VANTARA INTELLIGENCE</span>
            <h2>Built to understand the hotel.</h2>
            <p>When real operating data is connected, this layer will turn reservations, rooms, requests and guest communication into actionable operational context.</p>
            <div className="intel-footer">SOURCE OF TRUTH <span>CONNECTED LATER</span></div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Pulse({ label, detail, value }: { label: string; detail: string; value: string }) {
  return <div className="pulse"><div><strong>{label}</strong><span>{detail}</span></div><b>{value}</b></div>;
}

function Request({ title, detail, status }: { title: string; detail: string; status: string }) {
  return <div className="request"><div><strong>{title}</strong><span>{detail}</span></div><b>{status}</b></div>;
}
