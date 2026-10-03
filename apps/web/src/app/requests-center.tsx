'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type RequestItem = {
  id: string;
  title: string;
  message: string;
  status: 'CREATED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  category: string;
  createdAt: string;
  guest?: { firstName?: string; lastName?: string; name?: string };
  room?: { number?: string | number; name?: string } | null;
};

const statuses = ['ALL', 'CREATED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const nextStatus: Partial<Record<RequestItem['status'], RequestItem['status']>> = {
  CREATED: 'ACKNOWLEDGED',
  ACKNOWLEDGED: 'IN_PROGRESS',
  IN_PROGRESS: 'COMPLETED',
};

export function RequestsCenter() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [filter, setFilter] = useState<(typeof statuses)[number]>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    setLoading(true);
    try {
      const response = await fetch(`${base}/requests`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Unable to load requests (${response.status}).`);
      const data = await response.json();
      setRequests(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = async (request: RequestItem) => {
    const status = nextStatus[request.status];
    if (!status) return;
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    setUpdating(request.id);
    try {
      const response = await fetch(`${base}/requests/${request.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error('Status update failed.');
      const updated = await response.json();
      setRequests((current) => current.map((item) => item.id === request.id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setUpdating(null);
    }
  };

  const visible = useMemo(() => filter === 'ALL' ? requests : requests.filter((item) => item.status === filter), [filter, requests]);
  const open = requests.filter((item) => !['COMPLETED', 'CANCELLED'].includes(item.status)).length;
  const urgent = requests.filter((item) => item.priority === 'URGENT' && !['COMPLETED', 'CANCELLED'].includes(item.status)).length;

  return (
    <section className="requests-center">
      <div className="requests-hero">
        <div>
          <span className="panel-kicker">OPERATIONS / GUEST COMMUNICATION</span>
          <h2>Requests center</h2>
          <p>Every guest request, from arrival to completion, in one operational queue.</p>
        </div>
        <button className="refresh-button" onClick={() => void load()} disabled={loading}>↻ {loading ? 'Syncing' : 'Sync'}</button>
      </div>

      <div className="request-stats">
        <Stat label="Open" value={String(open)} />
        <Stat label="Urgent" value={String(urgent)} tone={urgent ? 'danger' : ''} />
        <Stat label="Total" value={String(requests.length)} />
        <Stat label="Realtime" value="LIVE" tone="live" />
      </div>

      <div className="request-toolbar">
        <div className="request-filters">
          {statuses.map((status) => (
            <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{status.replace('_', ' ')}</button>
          ))}
        </div>
        <span className="queue-count">{visible.length} {visible.length === 1 ? 'request' : 'requests'}</span>
      </div>

      {error && <div className="request-error">⚠ {error}</div>}
      {loading ? (
        <div className="request-empty"><span className="loading-orb" /><strong>Loading operational queue</strong><span>Connecting to Vantara source of truth...</span></div>
      ) : visible.length === 0 ? (
        <div className="request-empty"><span className="empty-mark">✓</span><strong>No requests in this view</strong><span>The queue is clear for this status filter.</span></div>
      ) : (
        <div className="request-list">
          {visible.map((request) => <RequestCard key={request.id} request={request} updating={updating === request.id} onAdvance={updateStatus} />)}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className={`request-stat ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function RequestCard({ request, updating, onAdvance }: { request: RequestItem; updating: boolean; onAdvance: (request: RequestItem) => void }) {
  const guestName = request.guest?.name ?? ([request.guest?.firstName, request.guest?.lastName].filter(Boolean).join(' ') || 'Guest');
  const room = request.room?.number ?? request.room?.name ?? 'Unassigned';
  const next = nextStatus[request.status];
  const age = formatAge(request.createdAt);
  return (
    <article className={`request-card priority-${request.priority.toLowerCase()}`}>
      <div className="request-card-main">
        <div className="request-card-top">
          <span className={`request-priority ${request.priority.toLowerCase()}`}>{request.priority}</span>
          <span className="request-age">{age}</span>
        </div>
        <h3>{request.title}</h3>
        <p>{request.message}</p>
        <div className="request-meta"><span>ROOM <b>{room}</b></span><span>GUEST <b>{guestName}</b></span><span>CATEGORY <b>{request.category.replace('_', ' ')}</b></span></div>
      </div>
      <div className="request-card-side">
        <span className={`request-status ${request.status.toLowerCase()}`}><i /> {request.status.replace('_', ' ')}</span>
        {next ? <button className="advance-button" onClick={() => onAdvance(request)} disabled={updating}>{updating ? 'Updating...' : `Move to ${next.replace('_', ' ')}`}</button> : <span className="completed-label">✓ Resolved</span>}
      </div>
    </article>
  );
}

function formatAge(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}