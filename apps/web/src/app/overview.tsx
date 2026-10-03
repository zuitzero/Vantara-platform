'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Guest = {
  id: string;
  firstName: string;
  lastName: string;
  status: 'ACTIVE' | 'INACTIVE' | string;
};

type Reservation = {
  id: string;
  confirmationCode: string;
  status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELED' | 'NO_SHOW' | string;
  checkIn: string;
  checkOut: string;
  guest?: { firstName: string; lastName: string };
  room?: { number: string } | null;
};

type GuestRequest = {
  id: string;
  title: string;
  message: string;
  category: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | string;
  status: 'CREATED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | string;
  createdAt: string;
  guest?: { firstName: string; lastName: string };
  room?: { number: string } | null;
};

type OverviewData = {
  guests: Guest[];
  reservations: Reservation[];
  requests: GuestRequest[];
};

const OPEN_REQUEST_STATUSES = new Set(['CREATED', 'ACKNOWLEDGED', 'IN_PROGRESS']);
const ACTIVE_RESERVATION_STATUSES = new Set(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

function isSameLocalDay(value: string, day: Date) {
  const date = new Date(value);
  return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate();
}

function ageLabel(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json() as Promise<T>;
}

export function Overview({ base }: { base: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [guests, reservations, requests] = await Promise.all([
        fetchJson<Guest[]>(`${base}/guests`),
        fetchJson<Reservation[]>(`${base}/reservations`),
        fetchJson<GuestRequest[]>(`${base}/requests`),
      ]);
      setData({ guests, reservations, requests });
    } catch {
      setError('Vantara could not load the live hotel overview.');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    if (!data) return null;
    const today = new Date();
    const activeGuests = data.guests.filter((guest) => guest.status === 'ACTIVE').length;
    const activeReservations = data.reservations.filter((reservation) => ACTIVE_RESERVATION_STATUSES.has(reservation.status)).length;
    const openRequests = data.requests.filter((request) => OPEN_REQUEST_STATUSES.has(request.status));
    const urgentRequests = openRequests.filter((request) => request.priority === 'URGENT').length;
    const arrivals = data.reservations.filter((reservation) => isSameLocalDay(reservation.checkIn, today) && !['CANCELED', 'NO_SHOW'].includes(reservation.status)).length;
    const departures = data.reservations.filter((reservation) => isSameLocalDay(reservation.checkOut, today) && !['CANCELED', 'NO_SHOW'].includes(reservation.status)).length;
    const checkedIn = data.reservations.filter((reservation) => reservation.status === 'CHECKED_IN').length;
    const recentRequests = [...data.requests]
      .filter((request) => OPEN_REQUEST_STATUSES.has(request.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    const reservationStates = [
      ['Pending', data.reservations.filter((item) => item.status === 'PENDING').length],
      ['Confirmed', data.reservations.filter((item) => item.status === 'CONFIRMED').length],
      ['Checked in', checkedIn],
      ['Completed', data.reservations.filter((item) => item.status === 'CHECKED_OUT').length],
    ] as const;
    const maxState = Math.max(1, ...reservationStates.map(([, count]) => count));

    return {
      activeGuests,
      activeReservations,
      openRequests: openRequests.length,
      urgentRequests,
      arrivals,
      departures,
      checkedIn,
      recentRequests,
      reservationStates,
      maxState,
    };
  }, [data]);

  if (loading) {
    return <section className="overview-state" aria-live="polite"><span className="state-signal" />Synchronizing hotel operations...</section>;
  }

  if (error || !summary) {
    return <section className="overview-state overview-error"><div><strong>Live overview unavailable</strong><span>{error ?? 'No operational data is available.'}</span></div><button onClick={() => void load()}>Retry</button></section>;
  }

  return <>
    <div className="truth-banner"><span className="truth-signal" /><div><strong>Source-of-truth mode</strong><span>Every number below is derived from the active hotel tenant. No demonstration metrics.</span></div><button onClick={() => void load()}>Refresh</button></div>

    <section className="metrics" aria-label="Live hotel metrics">
      <Metric label="Active guests" value={summary.activeGuests} detail="Guest profiles currently active" />
      <Metric label="Active reservations" value={summary.activeReservations} detail="Pending, confirmed or checked in" />
      <Metric label="Open requests" value={summary.openRequests} detail="Created, acknowledged or in progress" />
      <Metric label="Urgent requests" value={summary.urgentRequests} detail={summary.urgentRequests > 0 ? 'Immediate attention required' : 'No urgent requests'} danger={summary.urgentRequests > 0} />
    </section>

    <section className="grid command-grid">
      <div className="panel operations-chart">
        <div className="panel-head"><div><span className="panel-kicker">Reservations</span><h2>Stay pipeline</h2></div><span className="panel-meta">LIVE TENANT DATA</span></div>
        <div className="status-bars">
          {summary.reservationStates.map(([label, count]) => <div className="status-row" key={label}><div className="status-row-head"><span>{label}</span><strong>{count}</strong></div><div className="status-track"><i style={{ width: `${Math.max(count > 0 ? 8 : 0, (count / summary.maxState) * 100)}%` }} /></div></div>)}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><div><span className="panel-kicker">Today</span><h2>Hotel pulse</h2></div><span className="live-label"><i /> LIVE</span></div>
        <Pulse label="Arrivals" detail="Reservations checking in today" value={summary.arrivals} />
        <Pulse label="Departures" detail="Reservations checking out today" value={summary.departures} />
        <Pulse label="In house" detail="Reservations currently checked in" value={summary.checkedIn} />
        <Pulse label="Open requests" detail="Operational guest queue" value={summary.openRequests} />
      </div>
    </section>

    <section className="grid lower command-grid">
      <div className="panel">
        <div className="panel-head"><div><span className="panel-kicker">Guest operations</span><h2>Recent open requests</h2></div><span className="panel-meta">{summary.recentRequests.length} SHOWN</span></div>
        {summary.recentRequests.length === 0
          ? <div className="overview-empty">No open guest requests. The queue is clear.</div>
          : summary.recentRequests.map((request) => <div className="request" key={request.id}><div><strong>{request.title}</strong><span>{request.room?.number ? `Room ${request.room.number} · ` : ''}{request.guest ? `${request.guest.firstName} ${request.guest.lastName} · ` : ''}{ageLabel(request.createdAt)}</span></div><b className={request.priority === 'URGENT' ? 'danger-pill' : ''}>{request.status.replaceAll('_', ' ')}</b></div>)}
      </div>

      <div className="panel intelligence connected-intelligence">
        <div className="intel-orbit"><span /><span /><span /></div>
        <span className="panel-kicker">VANTARA INTELLIGENCE</span>
        <h2>Operational context, not decorative AI.</h2>
        <p>The intelligence layer now has a clean path to tenant-scoped guests, reservations and requests. Recommendations remain off until we can prove their inputs and outputs.</p>
        <div className="intel-footer">DATA FOUNDATION <span>CONNECTED</span></div>
      </div>
    </section>
  </>;
}

function Metric({ label, value, detail, danger = false }: { label: string; value: number; detail: string; danger?: boolean }) {
  return <div className={`metric-card ${danger ? 'metric-danger' : ''}`}><span>{label}</span><strong>{String(value).padStart(2, '0')}</strong><small>{detail}</small></div>;
}

function Pulse({ label, detail, value }: { label: string; detail: string; value: number }) {
  return <div className="pulse"><div><strong>{label}</strong><span>{detail}</span></div><b>{String(value).padStart(2, '0')}</b></div>;
}
