'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import './connect.css';

type Stay = {
  reservation: {
    id: string; confirmationCode: string; status: string; checkIn: string; checkOut: string;
    guest: { firstName: string; lastName: string };
    property: { name: string };
    roomType: { name: string };
    room: { number: string } | null;
  };
  requests: {
    id: string; title: string; message: string; category: string; priority: string; status: string;
    createdAt: string; completedAt: string | null; resolutionNote: string | null;
  }[];
  canRequest: boolean;
};

const quickActions = [
  { label: 'My room', description: 'Cleaning, towels or repairs', category: 'HOUSEKEEPING' },
  { label: 'Food & drinks', description: 'Room service', category: 'ROOM_SERVICE' },
  { label: 'Explore & enjoy', description: 'Amenities and recommendations', category: 'AMENITIES' },
  { label: 'Need help?', description: 'Front desk and other requests', category: 'FRONT_DESK' },
] as const;
const categoryOptions: Record<string, { value: string; label: string }[]> = {
  HOUSEKEEPING: [{ value: 'HOUSEKEEPING', label: 'Cleaning or towels' }, { value: 'MAINTENANCE', label: 'Something needs fixing' }],
  ROOM_SERVICE: [{ value: 'ROOM_SERVICE', label: 'Food or drinks' }],
  AMENITIES: [{ value: 'AMENITIES', label: 'Hotel amenities' }, { value: 'CONCIERGE', label: 'Recommendations and activities' }],
  FRONT_DESK: [{ value: 'FRONT_DESK', label: 'Front desk' }, { value: 'OTHER', label: 'Something else' }],
};
const isActive = (status: string) => status !== 'COMPLETED' && status !== 'CANCELLED';
const formatDate = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));

export default function ConnectPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const base = process.env.NEXT_PUBLIC_API_URL ?? '/api';
  const [stay, setStay] = useState<Stay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [group, setGroup] = useState('HOUSEKEEPING');
  const [category, setCategory] = useState('HOUSEKEEPING');
  const [success, setSuccess] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [syncWarning, setSyncWarning] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');
  const statusSnapshot = useRef<Map<string, string> | null>(null);

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (!background) { setLoading(true); setError(null); }
    try {
      const response = await fetch(`${base}/connect/${encodeURIComponent(token)}`, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(response.status === 404 ? 'This guest link is invalid or has expired.' : 'Unable to load your stay.');
      const updated = await response.json() as Stay;
      if (signal?.aborted) return false;
      const nextSnapshot = new Map(updated.requests.map(request => [request.id, request.status]));
      const previous = statusSnapshot.current;
      if (previous && background) {
        const changed = updated.requests.filter(request => previous.has(request.id) && previous.get(request.id) !== request.status);
        if (changed.length) setStatusNotice(changed.length === 1
          ? `Your request "${changed[0].title}" is now ${changed[0].status.replaceAll('_', ' ').toLowerCase()}.`
          : `${changed.length} requests have been updated by your hotel.`);
      }
      statusSnapshot.current = nextSnapshot;
      setStay(updated);
      setSyncWarning(false);
      setError(null);
      return true;
    } catch (failure) {
      if (signal?.aborted) return false;
      const message = failure instanceof Error ? failure.message : 'Unable to load your stay.';
      if (background && message !== 'This guest link is invalid or has expired.') {
        setSyncWarning(true);
      } else {
        setStay(null);
        setError(message);
      }
      return false;
    } finally {
      if (!signal?.aborted && !background) setLoading(false);
    }
  }, [base, token]);

  useEffect(() => {
    statusSnapshot.current = null;
    setStay(null);
    setLoading(true);
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (document.hidden || inFlight || controller.signal.aborted) return;
      inFlight = true;
      try { await load(controller.signal, true); } finally { inFlight = false; }
    };
    const interval = window.setInterval(() => void refresh(), 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  const activeRequests = useMemo(() => stay?.requests.filter(request => isActive(request.status)) ?? [], [stay]);
  const pastRequests = useMemo(() => stay?.requests.filter(request => !isActive(request.status)) ?? [], [stay]);

  const submit = async () => {
    if (!title.trim() || !message.trim()) return;
    setSending(true); setError(null); setSuccess(false);
    try {
      const response = await fetch(`${base}/connect/${encodeURIComponent(token)}/requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, title: title.trim(), message: message.trim(), priority: 'NORMAL', guestCount: 1 }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : 'Unable to send request.');
      setTitle(''); setMessage('');
      const refreshed = await load();
      if (refreshed) setSuccess(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to send request.');
    } finally { setSending(false); }
  };

  if (loading) return <main className="connect-shell"><section className="connect-card"><div className="connect-mark">V</div><h1>Opening your stay</h1><p>Connecting securely to the hotel…</p></section></main>;
  if (!stay) return <main className="connect-shell"><section className="connect-card"><div className="connect-mark">V</div><h1>Guest access unavailable</h1><p>{error ?? 'This Connect link is unavailable.'}</p></section></main>;

  const reservation = stay.reservation;
  return <main className="connect-shell">
    <section className="connect-app">
      <header className="connect-hero">
        <div><span>VANTARA CONNECT</span><h1>{reservation.property.name}</h1><p>Welcome, {reservation.guest.firstName}. Your stay is connected.</p></div>
        <div className="connect-mark">V</div>
      </header>

      <section className="connect-stay-card">
        <div><span>STAY</span><strong>{formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)}</strong></div>
        <div><span>ROOM</span><strong>{reservation.room ? `Room ${reservation.room.number}` : 'To be assigned'} · {reservation.roomType.name}</strong></div>
        <div><span>CONFIRMATION</span><strong>{reservation.confirmationCode}</strong></div>
        <div><span>STATUS</span><strong>{reservation.status.replaceAll('_', ' ')}</strong></div>
      </section>

      {error && <div className="connect-error">{error}</div>}
      {syncWarning && <div className="connect-error" role="status">Connection interrupted. Your latest request statuses may be out of date. We will keep trying.</div>}
      {statusNotice && <div className="connect-success" role="status">{statusNotice}<button className="connect-notice-dismiss" onClick={() => setStatusNotice('')} aria-label="Dismiss status update">×</button></div>}

      <section className="connect-panel">
        <div className="connect-section-head"><div><span>REQUEST SOMETHING</span><h2>How can the hotel help?</h2></div><small>{activeRequests.length} active</small></div>
        {stay.canRequest ? <div className="connect-form">
          <div className="connect-quick-actions" role="group" aria-label="Choose what you need">
            {quickActions.map(action => <button type="button" key={action.category} className={group === action.category ? 'selected' : ''} aria-pressed={group === action.category} onClick={() => { setGroup(action.category); setCategory(action.category); setSuccess(false); }}>
              <strong>{action.label}</strong><small>{action.description}</small>
            </button>)}
          </div>
          <label>Tell us a little more<select value={category} onChange={event => { setCategory(event.target.value); setSuccess(false); }}>{categoryOptions[group].map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>What do you need?<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Extra towels" maxLength={120} /></label>
          <label>Details<textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Tell the hotel what would make your stay better…" maxLength={1000} /></label>
          <button disabled={sending || !title.trim() || !message.trim()} onClick={() => void submit()}>{sending ? 'Sending…' : 'Send request'}</button>
          {success && <p role="status" className="connect-success">Request sent! Your hotel has received it. You can see it in Stay activity below.</p>}
        </div> : <p className="connect-muted">New requests are no longer available for this stay.</p>}
      </section>

      <section className="connect-panel">
        <div className="connect-section-head"><div><span>YOUR REQUESTS</span><h2>Active requests</h2></div><small>{activeRequests.length} active</small></div>
        {activeRequests.length === 0 ? <p className="connect-muted">No active requests. You are all caught up.</p> : <div className="connect-requests">{activeRequests.map(request => <article key={request.id}>
          <div><strong>{request.title}</strong><span>{request.category.replaceAll('_', ' ')}</span></div>
          <p>{request.message}</p><small>{request.status.replaceAll('_', ' ')} · {formatDate(request.createdAt)}</small>
          {request.resolutionNote && <blockquote>{request.resolutionNote}</blockquote>}
        </article>)}</div>}
      </section>

      <section className="connect-panel">
        <div className="connect-section-head"><div><span>YOUR HISTORY</span><h2>Completed & cancelled</h2></div><small>{pastRequests.length} past</small></div>
        {pastRequests.length === 0 ? <p className="connect-muted">Your completed requests will appear here.</p> : <div className="connect-requests">{pastRequests.map(request => <article key={request.id}>
          <div><strong>{request.title}</strong><span>{request.category.replaceAll('_', ' ')}</span></div>
          <p>{request.message}</p><small>{request.status.replaceAll('_', ' ')} · {formatDate(request.completedAt ?? request.createdAt)}</small>
          {request.resolutionNote && <blockquote>{request.resolutionNote}</blockquote>}
        </article>)}</div>}
      </section>
    </section>
  </main>;
}
