'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './reservations-center.css';
import { FrontDeskForm } from './front-desk-forms';

type Status = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELED' | 'NO_SHOW';
type Reservation = {
  id: string; propertyId: string; roomTypeId: string; status: Status; confirmationCode: string; checkIn: string; checkOut: string;
  adults: number; children: number; notes: string | null;
  guest: { firstName: string; lastName: string };
  property: { name: string }; roomType: { name: string }; room: { number: string } | null;
};
const statuses: Status[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELED', 'NO_SHOW'];
// Presentation of the existing API lifecycle; the server validates all transitions and owns side effects.
const actions: Partial<Record<Status, { status: Status; label: string }[]>> = {
  PENDING: [{ status: 'CONFIRMED', label: 'Confirm' }, { status: 'CANCELED', label: 'Cancel' }],
  CONFIRMED: [{ status: 'CHECKED_IN', label: 'Check in' }, { status: 'CANCELED', label: 'Cancel' }, { status: 'NO_SHOW', label: 'Mark no-show' }],
  CHECKED_IN: [{ status: 'CHECKED_OUT', label: 'Check out' }],
};
const label = (status: string) => status.replaceAll('_', ' ');
const date = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));

export function ReservationsCenter({ base, canManage, initialGuestId, onGuestConsumed }: { base: string; canManage: boolean; initialGuestId?: string | null; onGuestConsumed?: () => void }) {
  const [creating, setCreating] = useState(!!initialGuestId);
  const [assigning, setAssigning] = useState<Reservation | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch(`${base}/reservations`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`Unable to load reservations (${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid reservation response.');
      if (request === generation.current) { setReservations(data); setLoadError(null); }
    } catch (error) {
      if (request === generation.current) setLoadError(error instanceof Error ? error.message : 'Unable to load reservations.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [base]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  const transition = async (reservation: Reservation, status: Status) => {
    if (!canManage || busy.current) return;
    if ((status === 'CANCELED' || status === 'NO_SHOW') && !window.confirm(`${label(status)}: ${reservation.confirmationCode}?`)) return;
    busy.current = true;
    setUpdating(reservation.id);
    setMutationError(null);
    try {
      const response = await fetch(`${base}/reservations/${encodeURIComponent(reservation.id)}/status`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.message === 'string' ? body.message : `Reservation update failed (${response.status}).`);
      }
      // Reload authoritative data, including room and guest relationships, after the server transaction.
      await load();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Reservation update failed.');
    } finally { busy.current = false; setUpdating(null); }
  };
  const visible = reservations.filter(item => filter === 'ALL' || item.status === filter);
  return <section className="reservations-center" aria-busy={loading}>
    <div className="requests-hero"><div><span className="panel-kicker">HOTEL OPERATIONS / STAYS</span><h2>Reservations</h2><p>Tenant-scoped stays and arrivals, with lifecycle updates managed by Vantara.</p></div>
      <div className="front-desk-actions">{canManage && <button className="advance-button" disabled={!!updating} onClick={() => setCreating(true)}>Create reservation</button>}<button className="refresh-button" disabled={loading || !!updating} onClick={() => void load()}>{loading ? 'Syncing…' : 'Refresh'}</button></div></div>
    {creating && canManage && <FrontDeskForm base={base} mode="reservation" initialGuestId={initialGuestId ?? undefined} onCancel={() => { setCreating(false); onGuestConsumed?.(); }} onSaved={async () => { setCreating(false); onGuestConsumed?.(); await load(); }} />}
    {assigning && canManage && <FrontDeskForm key={assigning.id} base={base} mode="assignment" reservation={assigning} onCancel={() => setAssigning(null)} onSaved={async () => { setAssigning(null); await load(); }} />}
    <div className="request-toolbar"><div className="request-filters" aria-label="Reservation status">
      {(['ALL', ...statuses] as const).map(status => <button key={status} aria-pressed={filter === status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{label(status)}</button>)}
    </div></div>
    {mutationError && <div className="request-error" role="alert">{mutationError} Retry the action or refresh to verify the current state.</div>}
    {loading ? <div className="request-empty" role="status">Loading reservations…</div>
      : loadError ? <div className="request-empty" role="alert"><strong>{loadError}</strong><button className="refresh-button" onClick={() => void load()}>Retry</button></div>
      : visible.length === 0 ? <div className="request-empty"><strong>No reservations in this view</strong><span>{filter === 'ALL' ? 'No reservations have been recorded for this hotel.' : 'Choose another status to view other stays.'}</span></div>
      : <div className="request-list">{visible.map(reservation => <article className="request-card reservation-card" key={reservation.id}>
        <div className="request-card-main"><span className="panel-kicker">{reservation.confirmationCode}</span><h3>{reservation.guest.firstName} {reservation.guest.lastName}</h3>
          <dl className="reservation-context"><div><dt>Arrival</dt><dd>{date(reservation.checkIn)}</dd></div><div><dt>Departure</dt><dd>{date(reservation.checkOut)}</dd></div>
            <div><dt>Room / type</dt><dd>{reservation.room ? `Room ${reservation.room.number}` : 'Unassigned'} · {reservation.roomType.name}</dd></div>
            <div><dt>Property</dt><dd>{reservation.property.name}</dd></div><div><dt>Guests</dt><dd>{reservation.adults} adults · {reservation.children} children</dd></div></dl>
          {reservation.notes && <p>{reservation.notes}</p>}
        </div><div className="request-card-side"><span className={`request-status ${reservation.status.toLowerCase()}`}>{label(reservation.status)}</span>
          {canManage && ['PENDING', 'CONFIRMED'].includes(reservation.status) && <button className="advance-button" disabled={!!updating} onClick={() => setAssigning(reservation)}>{reservation.room ? 'Change room' : 'Assign room'}</button>}
          {canManage ? (actions[reservation.status] ?? []).map(action => <button className="advance-button" key={action.status} disabled={!!updating || ((action.status === 'CHECKED_IN' || action.status === 'CHECKED_OUT') && !reservation.room)} onClick={() => void transition(reservation, action.status)}>{updating === reservation.id ? 'Updating…' : action.label}</button>) : <span className="completed-label">Read only</span>}
          {canManage && !reservation.room && ['CONFIRMED', 'CHECKED_IN'].includes(reservation.status) && <small>A room assignment is required.</small>}
        </div></article>)}</div>}
  </section>;
}
