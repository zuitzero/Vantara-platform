'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './guests-center.css';

type GuestStatus = 'ACTIVE' | 'INACTIVE';
type ReservationContext = {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN';
  confirmationCode: string;
  checkIn: string;
  checkOut: string;
  property: { name: string };
  room: { number: string } | null;
  roomType: { name: string };
};
type Guest = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: GuestStatus;
  property: { name: string } | null;
  room: { number: string; roomType: { name: string } } | null;
  reservations?: ReservationContext[];
};

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : dateFormatter.format(parsed);
}
function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function matchesSearch(guest: Guest, query: string) {
  const search = normalize(query);
  if (!search) return true;
  const fields = [`${guest.firstName} ${guest.lastName}`, guest.email ?? '', guest.phone ?? ''];
  if (fields.some(value => normalize(value).includes(search))) return true;
  const digits = search.replace(/\D/g, '');
  return digits.length > 0 && /^[+\d\s().-]+$/.test(search)
    && (guest.phone ?? '').replace(/\D/g, '').includes(digits);
}

export function GuestsCenter({ base }: { base: string }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<GuestStatus | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${base}/guests`, {
        credentials: 'include', cache: 'no-store', signal: abort.signal,
      });
      if (!response.ok) {
        throw new Error(response.status === 403
          ? 'You do not have permission to read guests in this workspace.'
          : response.status === 401 ? 'Your session is unavailable. Sign in to load guests.'
          : `Unable to load guests (${response.status}).`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid guest response.');
      if (request === generation.current) setGuests(data);
    } catch (failure) {
      if (!abort.signal.aborted && request === generation.current) {
        setError(failure instanceof Error ? failure.message : 'Unable to load guests.');
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
    return () => { generation.current++; controller.current?.abort(); };
  }, [load]);

  const visible = guests.filter(guest => (filter === 'ALL' || guest.status === filter) && matchesSearch(guest, query));
  const clearFilters = () => { setQuery(''); setFilter('ALL'); };

  return <section className="guests-center" aria-busy={loading}>
    <div className="requests-hero">
      <div><span className="panel-kicker">HOTEL OPERATIONS / FRONT DESK</span><h2>Guests / Front Desk</h2><p>Guest identity, assigned rooms and current or scheduled stays.</p></div>
      <button className="refresh-button" disabled={loading} onClick={() => void load()}>{loading ? 'Syncing…' : 'Refresh'}</button>
    </div>
    <div className="guest-toolbar">
      <div className="guest-search"><label htmlFor="guest-search">Search guests</label><input id="guest-search" type="search" autoComplete="off" placeholder="Name, email or phone" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="guest-filter"><label htmlFor="guest-status">Guest record status</label><select id="guest-status" value={filter} onChange={event => setFilter(event.target.value as GuestStatus | 'ALL')}>
        <option value="ALL">All statuses</option><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option>
      </select></div>
      {!loading && !error && <span className="queue-count" role="status">{visible.length} of {guests.length} guests</span>}
    </div>
    <p className="guest-status-note">ACTIVE / INACTIVE describes the guest record. CHECKED IN identifies a current reservation stay.</p>
    {loading ? <div className="request-empty" role="status"><span className="loading-orb" /><strong>Loading guests</strong><span>Retrieving hotel guest and stay context…</span></div>
      : error ? <div className="request-empty" role="alert"><strong>Guests unavailable</strong><span>{error}</span><button className="refresh-button" onClick={() => void load()}>Retry</button></div>
      : guests.length === 0 ? <div className="request-empty"><strong>No guests recorded</strong><span>This hotel has no guest records yet.</span></div>
      : visible.length === 0 ? <div className="request-empty"><strong>No matching guests</strong><span>Try another name, email, phone or status.</span><button className="refresh-button" onClick={clearFilters}>Clear search and filters</button></div>
      : <div className="request-list">{visible.map(guest => <GuestCard guest={guest} key={guest.id} />)}</div>}
  </section>;
}

function GuestCard({ guest }: { guest: Guest }) {
  const currentStays = guest.reservations?.filter(reservation => reservation.status === 'CHECKED_IN') ?? [];
  const scheduledStays = guest.reservations?.filter(reservation => reservation.status !== 'CHECKED_IN') ?? [];
  const stays = [...currentStays, ...scheduledStays];
  return <article className="request-card guest-card">
    <div className="request-card-main">
      <div className="guest-card-heading"><h3>{guest.firstName} {guest.lastName}</h3><span className={`guest-record-status ${guest.status.toLowerCase()}`}>{guest.status}</span>
        <span className="guest-stay-status">{currentStays.length > 0 ? 'CHECKED IN' : 'No checked-in reservation'}</span></div>
      <dl className="guest-context">
        <div><dt>Email</dt><dd>{guest.email || 'Not provided'}</dd></div>
        <div><dt>Phone</dt><dd>{guest.phone || 'Not provided'}</dd></div>
        <div><dt>Current room assignment</dt><dd>{guest.room ? `Room ${guest.room.number} · ${guest.room.roomType.name}` : 'No room assigned'}</dd></div>
        <div><dt>Associated property</dt><dd>{guest.property?.name ?? 'No property associated'}</dd></div>
      </dl>
      <div className="guest-reservations">
        <h4>Current / scheduled reservations</h4>
        {guest.reservations === undefined ? <p>Reservation context unavailable. Refresh after the API is updated.</p>
          : stays.length === 0 ? <p>No current or upcoming reservation.</p>
          : stays.map(reservation => <div className="guest-reservation" key={reservation.id}>
            <div className="guest-reservation-heading"><strong>{reservation.confirmationCode}</strong><span>{reservation.status.replaceAll('_', ' ')}</span></div>
            <dl className="guest-context">
              <div><dt>Arrival</dt><dd>{date(reservation.checkIn)}</dd></div><div><dt>Departure</dt><dd>{date(reservation.checkOut)}</dd></div>
              <div><dt>Reservation room / type</dt><dd>{reservation.room ? `Room ${reservation.room.number}` : 'Unassigned'} · {reservation.roomType.name}</dd></div>
              <div><dt>Reservation property</dt><dd>{reservation.property.name}</dd></div>
            </dl>
          </div>)}
      </div>
    </div>
  </article>;
}
