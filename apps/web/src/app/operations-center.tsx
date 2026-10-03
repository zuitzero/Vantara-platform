'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './operations-center.css';

type Mode = 'housekeeping' | 'maintenance';
type OpsItem = {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  status: string;
  priority: string;
  assignedTo?: string | null;
  assignedStaffId?: string | null;
  propertyId: string;
  assignedStaff?: { membership: { user: { name: string } } } | null;
  createdAt: string;
  room: { number: string; roomType?: { name?: string } };
  property: { name: string };
};

type Assignee = { id: string; propertyId: string | null; membership: { user: { name: string } } };

const flows: Record<Mode, Record<string, string | undefined>> = {
  housekeeping: { PENDING: 'ASSIGNED', ASSIGNED: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' },
  maintenance: { OPEN: 'ASSIGNED', ASSIGNED: 'IN_PROGRESS', IN_PROGRESS: 'RESOLVED' },
};

const terminal: Record<Mode, string[]> = {
  housekeeping: ['COMPLETED', 'CANCELLED'],
  maintenance: ['RESOLVED', 'CANCELLED'],
};

export function OperationsCenter({ base, mode, canManage }: { base: string; mode: Mode; canManage: boolean }) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const busy = useRef(false);
  const generation = useRef(0);
  const [items, setItems] = useState<OpsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState('OPEN');

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch(`${base}/${mode}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Unable to load ${mode} (${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid operations response.');
      let candidates: Assignee[] = [];
      if (canManage) {
        const candidateResponse = await fetch(`${base}/${mode}/assignees`, { credentials: 'include', cache: 'no-store' });
        if (!candidateResponse.ok) throw new Error('Unable to load assignment candidates.');
        candidates = await candidateResponse.json();
        if (!Array.isArray(candidates)) throw new Error('Invalid staff response.');
      }
      if (request === generation.current) { setItems(data); setAssignees(candidates); setError(null); }
    } catch (err) {
      if (request === generation.current) setError(err instanceof Error ? err.message : `Unable to load ${mode}.`);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [base, mode, canManage]);

  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  const visible = useMemo(() => filter === 'ALL' ? items : filter === 'OPEN' ? items.filter((item) => !terminal[mode].includes(item.status)) : items.filter((item) => item.status === filter), [filter, items, mode]);
  const urgent = items.filter((item) => item.priority === 'URGENT' && !terminal[mode].includes(item.status)).length;
  const completed = items.filter((item) => terminal[mode][0] === item.status).length;

  const mutate = async (item: OpsItem, body: { status?: string; assignedStaffId?: string | null }) => {
    if (!canManage || busy.current) return;
    busy.current = true;
    setUpdating(item.id);
    try {
      const response = await fetch(`${base}/${mode}/${item.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(Array.isArray(failure?.message) ? failure.message.join(' ') : failure?.message ?? 'Operation failed.');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      busy.current = false;
      setUpdating(null);
    }
  };

  const title = mode === 'housekeeping' ? 'Housekeeping' : 'Maintenance';
  const copy = mode === 'housekeeping' ? 'Cleaning operations synchronized with room readiness.' : 'Room issues tracked from detection to resolution.';
  const statuses = mode === 'housekeeping' ? ['OPEN', 'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'ALL'] : ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'ALL'];

  return <section className="ops-center">
    <div className="requests-hero"><div><span className="panel-kicker">OPERATIONS / {title.toUpperCase()}</span><h2>{title}</h2><p>{copy}</p></div><button className="refresh-button" onClick={() => void load()} disabled={loading || !!updating}>↻ {loading ? 'Syncing' : 'Sync'}</button></div>
    <div className="request-stats"><Stat label="Open" value={String(items.filter((item) => !terminal[mode].includes(item.status)).length)} /><Stat label="Urgent" value={String(urgent)} tone={urgent ? 'danger' : ''} /><Stat label="Completed" value={String(completed)} /><Stat label="Source" value="LIVE" tone="live" /></div>
    <div className="request-toolbar"><div className="request-filters">{statuses.map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{status.replace('_', ' ')}</button>)}</div><span className="queue-count">{visible.length} items</span></div>
    {error && <div className="request-error" role="alert">⚠ {error} <button className="refresh-button" disabled={loading || !!updating} onClick={() => void load()}>Retry / refresh</button></div>}
    {loading ? <div className="request-empty"><span className="loading-orb" /><strong>Loading {title.toLowerCase()}</strong><span>Reading live tenant operations...</span></div> : error ? <div className="request-empty"><strong>Operations unavailable</strong><span>Refresh to reload the operational queue.</span></div> : visible.length === 0 ? <div className="request-empty"><span className="empty-mark">✓</span><strong>No work in this view</strong><span>This operational queue is clear.</span></div> : <div className="ops-grid">{visible.map((item) => {
      const next = flows[mode][item.status];
      return <article className={`ops-card priority-${item.priority.toLowerCase()}`} key={item.id}><div className="ops-card-head"><div><span className="request-priority">{item.priority}</span><h3>{item.title}</h3></div><span className={`request-status ${item.status.toLowerCase()}`}><i /> {item.status.replace('_', ' ')}</span></div><p>{item.description ?? item.notes ?? 'No additional notes.'}</p><div className="request-meta"><span>ROOM <b>{item.room.number}</b></span><span>TYPE <b>{item.room.roomType?.name ?? 'Room'}</b></span><span>PROPERTY <b>{item.property.name}</b></span><span>ASSIGNED <b>{item.assignedStaff?.membership.user.name ?? (item.assignedTo ? `Legacy label: ${item.assignedTo}` : 'Unassigned')}</b></span></div>{canManage && !terminal[mode].includes(item.status) && <label className="ops-assignment">Assigned staff<select aria-label={`Assign ${item.title}`} value={item.assignedStaffId ?? ''} disabled={!!updating} onChange={event => void mutate(item, { assignedStaffId: event.target.value || null })}><option value="">Unassigned</option>{item.assignedStaffId && !assignees.some(staff => staff.id === item.assignedStaffId) && <option value={item.assignedStaffId} disabled>{item.assignedStaff?.membership.user.name ?? 'Previous assignee'} · unavailable</option>}{assignees.filter(staff => !staff.propertyId || staff.propertyId === item.propertyId).map(staff => <option key={staff.id} value={staff.id}>{staff.membership.user.name}</option>)}</select></label>}{canManage && next && next !== 'ASSIGNED' ? <button className="advance-button ops-action" onClick={() => void mutate(item, { status: next })} disabled={!!updating}>{updating === item.id ? 'Updating...' : `Move to ${next.replace('_', ' ')}`}</button> : <span className="completed-label">{terminal[mode].includes(item.status) ? '✓ Closed' : canManage ? 'Choose staff to assign this work' : 'Read only'}</span>}</article>;
    })}</div>}
  </section>;
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className={`request-stat ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}
