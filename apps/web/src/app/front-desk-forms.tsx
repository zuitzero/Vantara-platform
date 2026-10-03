'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import './front-desk-forms.css';

type Property = { id: string; name: string };
type Guest = { id: string; firstName: string; lastName: string; email: string | null };
type RoomType = { id: string; name: string; propertyId: string };
type Room = { id: string; number: string; propertyId: string; roomTypeId: string; roomType: { name: string }; occupancyStatus: string; readinessStatus: string };
type Props = {
  base: string; mode: 'guest' | 'reservation' | 'assignment'; initialGuestId?: string;
  reservation?: { id: string; propertyId: string; roomTypeId: string; confirmationCode: string; room: { number: string } | null };
  onCancel: () => void; onSaved: (id: string) => void | Promise<void>;
};

async function backendError(response: Response) {
  const body = await response.json().catch(() => null);
  return Array.isArray(body?.message) ? body.message.join(' ') : typeof body?.message === 'string' ? body.message : `Operation failed (${response.status}).`;
}

export function FrontDeskForm({ base, mode, initialGuestId, reservation, onCancel, onSaved }: Props) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [types, setTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [propertyId, setPropertyId] = useState(reservation?.propertyId ?? '');
  const [roomTypeId, setRoomTypeId] = useState(reservation?.roomTypeId ?? '');
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError(null);
    const paths = mode === 'guest' ? ['properties'] : mode === 'assignment' ? ['rooms'] : ['properties', 'guests', 'room-types', 'rooms'];
    void Promise.all(paths.map(async path => {
      const response = await fetch(`${base}/${path}`, { credentials: 'include', cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw new Error(await backendError(response));
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error(`Invalid ${path} response.`);
      return { path, data };
    })).then(results => {
      if (abort.signal.aborted) return;
      for (const { path, data } of results) {
        if (path === 'properties') setProperties(data);
        if (path === 'guests') setGuests(data);
        if (path === 'room-types') setTypes(data);
        if (path === 'rooms') setRooms(data);
      }
    }).catch(failure => {
      if (!abort.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'Unable to load form data.');
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [base, mode, retry]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    const values = new FormData(event.currentTarget);
    const text = (key: string) => String(values.get(key) ?? '').trim();
    let body: Record<string, unknown>;
    let path = mode === 'guest' ? 'guests' : 'reservations';
    if (mode === 'guest') {
      body = { firstName: text('firstName'), lastName: text('lastName'), ...(text('email') ? { email: text('email') } : {}), ...(text('phone') ? { phone: text('phone') } : {}), ...(propertyId ? { propertyId } : {}) };
    } else if (mode === 'assignment' && reservation) {
      path = `reservations/${encodeURIComponent(reservation.id)}/room`;
      body = { roomId };
    } else {
      body = { guestId: text('guestId'), propertyId, roomTypeId, checkIn: text('checkIn'), checkOut: text('checkOut'), adults: Number(text('adults')), children: Number(text('children')), ...(roomId ? { roomId } : {}), ...(text('notes') ? { notes: text('notes') } : {}) };
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${base}/${path}`, {
        method: mode === 'assignment' ? 'PATCH' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await backendError(response));
      const saved = await response.json();
      await onSaved(saved.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Operation failed.');
    } finally { busy.current = false; setSaving(false); }
  };
  const eligibleRooms = rooms.filter(room => room.propertyId === propertyId && room.roomTypeId === roomTypeId);
  const title = mode === 'guest' ? 'Create guest' : mode === 'assignment' ? `Assign room · ${reservation?.confirmationCode}` : 'Create reservation';
  return <section className="front-desk-form" aria-label={title}>
    <h3>{title}</h3>
    {loading ? <p role="status">Loading hotel data…</p> : loadError ? <div role="alert"><p>{loadError}</p><button className="refresh-button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
      : <form onSubmit={event => void submit(event)}>
        <fieldset disabled={saving}>
          {mode === 'guest' ? <>
            <label>First name<input name="firstName" required maxLength={80} autoComplete="given-name" /></label>
            <label>Last name<input name="lastName" required maxLength={80} autoComplete="family-name" /></label>
            <label>Email (optional)<input name="email" type="email" autoComplete="email" /></label>
            <label>Phone (optional)<input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
          </> : mode === 'reservation' ? <label>Guest<select name="guestId" required defaultValue={initialGuestId ?? ''}><option value="">Select guest</option>{guests.map(guest => <option key={guest.id} value={guest.id}>{guest.firstName} {guest.lastName}{guest.email ? ` · ${guest.email}` : ''}</option>)}</select></label> : null}
          {mode !== 'assignment' && <label>Property{mode === 'guest' ? ' (optional)' : ''}<select required={mode === 'reservation'} value={propertyId} onChange={event => { setPropertyId(event.target.value); setRoomTypeId(''); setRoomId(''); }}><option value="">{mode === 'guest' ? 'No association' : 'Select property'}</option>{properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>}
          {mode === 'reservation' && <>
            <label>Room type<select required value={roomTypeId} onChange={event => { setRoomTypeId(event.target.value); setRoomId(''); }}><option value="">Select room type</option>{types.filter(type => type.propertyId === propertyId).map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <label>Check-in date<input type="date" name="checkIn" required /></label><label>Check-out date<input type="date" name="checkOut" required /></label>
            <label>Adults<input type="number" name="adults" min={1} step={1} defaultValue={1} required /></label><label>Children<input type="number" name="children" min={0} step={1} defaultValue={0} required /></label>
            <label className="form-wide">Notes (optional)<textarea name="notes" rows={2} /></label>
          </>}
          {mode !== 'guest' && <label className="form-wide">Room{mode === 'reservation' ? ' (optional)' : ''}<select required={mode === 'assignment'} value={roomId} onChange={event => setRoomId(event.target.value)}>
            <option value="">{mode === 'assignment' ? 'Select a room' : 'Assign later'}</option>
            {eligibleRooms.map(room => <option key={room.id} value={room.id} disabled={room.occupancyStatus === 'OCCUPIED' || room.readinessStatus === 'OUT_OF_SERVICE'}>Room {room.number} · {room.roomType.name} · {room.occupancyStatus} · {room.readinessStatus}{room.occupancyStatus === 'OCCUPIED' || room.readinessStatus === 'OUT_OF_SERVICE' ? ' · unavailable now' : room.readinessStatus !== 'READY' ? ' · not check-in ready' : ''}</option>)}
          </select><small>Check-in requires VACANT + READY. The server checks stay-date conflicts when saving.</small>{eligibleRooms.length === 0 && <small>No rooms match this property and room type.</small>}</label>}
        </fieldset>
        {error && <p className="request-error" role="alert">{error}</p>}
        <div className="front-desk-actions"><button className="advance-button" type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'assignment' ? 'Save room assignment' : title}</button><button className="refresh-button" type="button" disabled={saving} onClick={onCancel}>Cancel</button></div>
      </form>}
    {(loading || loadError) && <button className="refresh-button" onClick={onCancel}>Cancel</button>}
  </section>;
}
