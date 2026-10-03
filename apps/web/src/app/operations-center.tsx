'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Mode = 'housekeeping' | 'maintenance';
type OpsItem = {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  status: string;
  priority: string;
  assignedTo?: string | null;
  createdAt: string;
  room: { number: string; roomType?: { name?: string } };
  property: { name: string };
};

const flows: Record<Mode, Record<string, string | undefined>> = {
  housekeeping: { PENDING: 'ASSIGNED', ASSIGNED: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' },
  maintenance: { OPEN: 'ASSIGNED', ASSIGNED: 'IN_PROGRESS', IN_PROGRESS: 'RESOLVED' },
};

const terminal: Record<Mode, string[]> = {
  housekeeping: ['COMPLETED', 'CANCELLED'],
  maintenance: ['RESOLVED', 'CANCELLED'],
};

export function OperationsCenter({ base, mode }: { base: string; mode: Mode }) {
  const [items, setItems] = useState<OpsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState('OPEN');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${base}/${mode}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Unable to load ${mode} (${response.status}).`);
      const data = await response.json();
      setItems(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to load ${mode}.`);
    } finally {
      setLoading(false);
    }
  }, [base, mode]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => filter === 'ALL' ? items : filter === 'OPEN' ? items.filter((item) => !terminal[mode].includes(item.status)) : items.filter((item) => item.status === filter), [filter, items, mode]);
  const urgent = items.filter((item) => item.priority === 'URGENT' && !terminal[mode].includes(item.status)).length;
  const completed = items.filter((item) => terminal[mode][0] === item.status).length;

  const advance = async (item: OpsItem) => {
    const status = flows[mode][item.status];
    if (!status) return;
    setUpdating(item.id);
    try {
      const response = await fetch(`${base}/${mode}/${item.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error('Status update failed.');
      const updated = await response.json();
      setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setUpdating(null);
    }
  };

  const title = mode === 'housekeeping' ? 'Housekeeping' : 'Maintenance';
  const copy = mode === 'housekeeping' ? 'Cleaning operations synchronized with room readiness.' : 'Room issues tracked from detection to resolution.';
  const statuses = mode === 'housekeeping' ? ['OPEN', 'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'ALL'] : ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'ALL'];

  return <section className="ops-center">
    <div className="requests-hero"><div><span className="panel-kicker">OPERATIONS / {title.toUpperCase()}</span><h2>{title}</h2><p>{copy}</p></div><button className="refresh-button" onClick={() => void load()} disabled={loading}>↻ {loading ? 'Syncing' : 'Sync'}</button></div>
    <div className="request-stats"><Stat label="Open" value={String(items.filter((item) => !terminal[mode].includes(item.status)).length)} /><Stat label="Urgent" value={String(urgent)} tone={urgent ? 'danger' : ''} /><Stat label="Completed" value={String(completed)} /><Stat label="Source" value="LIVE" tone="live" /></div>
    <div className="request-toolbar"><div className="request-filters">{statuses.map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{status.replace('_', ' ')}</button>)}</div><span className="queue-count">{visible.length} items</span></div>
    {error && <div className="request-error">⚠ {error}</div>}
    {loading ? <div className="request-empty"><span className="loading-orb" /><strong>Loading {title.toLowerCase()}</strong><span>Reading live tenant operations...</span></div> : visible.length === 0 ? <div className="request-empty"><span className="empty-mark">✓</span><strong>No work in this view</strong><span>This operational queue is clear.</span></div> : <div className="ops-grid">{visible.map((item) => {
      const next = flows[mode][item.status];
      return <article className={`ops-card priority-${item.priority.toLowerCase()}`} key={item.id}><div className="ops-card-head"><div><span className="request-priority">{item.priority}</span><h3>{item.title}</h3></div><span className={`request-status ${item.status.toLowerCase()}`}><i /> {item.status.replace('_', ' ')}</span></div><p>{item.description ?? item.notes ?? 'No additional notes.'}</p><div className="request-meta"><span>ROOM <b>{item.room.number}</b></span><span>TYPE <b>{item.room.roomType?.name ?? 'Room'}</b></span><span>PROPERTY <b>{item.property.name}</b></span>{item.assignedTo && <span>ASSIGNED <b>{item.assignedTo}</b></span>}</div>{next ? <button className="advance-button ops-action" onClick={() => void advance(item)} disabled={updating === item.id}>{updating === item.id ? 'Updating...' : `Move to ${next.replace('_', ' ')}`}</button> : <span className="completed-label">✓ Closed</span>}</article>;
    })}</div>}
  </section>;
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className={`request-stat ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}