'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import '../command-center.css';
import '../front-desk-forms.css';
import './setup.css';

type Setup = { propertyConfigured: boolean; roomTypesConfigured: boolean; roomsConfigured: boolean; operationallyReady: boolean; properties: { id: string; name: string; roomTypesConfigured: boolean; roomsConfigured: boolean }[] };
type RoomType = { id: string; name: string; code: string; propertyId: string };
type Room = { id: string; number: string; propertyId: string };
const plans = ['LOBBY', 'SUITE', 'GRAND'];

async function read(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(Array.isArray(data?.message) ? data.message.join(' ') : data?.message ?? `Request failed (${response.status}).`);
  return data;
}

export default function HotelOnboarding() {
  const base = process.env.NEXT_PUBLIC_API_URL ?? '/api';
  const [mode, setMode] = useState<'create' | 'login' | 'setup' | 'denied'>('create');
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<Setup | null>(null);
  const [types, setTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [email, setEmail] = useState('');

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`${base}/auth/me`, { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) { if (request === generation.current) { setStatus(null); setMode(current => current === 'setup' ? 'login' : current); } return; }
      const workspace = await read(response);
      if (workspace.membership?.role !== 'HOTEL_ADMIN') { if (request === generation.current) setMode('denied'); return; }
      const [setup, roomTypes, inventory] = await Promise.all([
        fetch(`${base}/onboarding/status`, { credentials: 'include', cache: 'no-store' }).then(read),
        fetch(`${base}/room-types`, { credentials: 'include', cache: 'no-store' }).then(read),
        fetch(`${base}/rooms`, { credentials: 'include', cache: 'no-store' }).then(read),
      ]);
      if (request !== generation.current) return;
      setStatus(setup); setTypes(roomTypes); setRooms(inventory); setMode('setup');
      setPropertyId(current => setup.properties.some((property: { id: string }) => property.id === current) ? current : setup.properties[0]?.id ?? '');
    } catch (err) { if (request === generation.current) setError(err instanceof Error ? err.message : 'Unable to load setup.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [base]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { setRoomTypeId(types.find(type => type.propertyId === propertyId)?.id ?? ''); }, [propertyId, types]);

  async function submit(event: FormEvent<HTMLFormElement>, path: string, done: string) {
    event.preventDefault(); if (busy.current) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if ('email' in values) values.email = String(values.email).trim().toLowerCase();
    const payload: Record<string, unknown> = { ...values };
    if ('maxGuests' in payload) payload.maxGuests = Number(payload.maxGuests);
    busy.current = true; setMutating(true); setError(null); setNotice(null);
    try {
      await fetch(`${base}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(read);
      setNotice(done); form.reset();
      if (path === '/onboarding/workspace') { setMode('login'); }
      else await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save setup.'); }
    finally { busy.current = false; setMutating(false); }
  }

  return <main className="setup-shell"><section className="setup-panel">
    <span className="panel-kicker">VANTARA / HOTEL SETUP</span><h1>Open your hotel workspace</h1>
    {error && <div className="request-error" role="alert">{error} <button onClick={() => void load()} disabled={loading || mutating}>Retry / refresh</button></div>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading authenticated setup…</p> : mode === 'denied' ? <p>Hotel setup requires a HOTEL_ADMIN membership. <a href="/">Return to workspace</a></p> : mode === 'setup' && status ? <>
      <div className="setup-checklist"><span>Workspace created ✓</span><span>Property {status.propertyConfigured ? '✓' : 'required'}</span><span>Room types {status.roomTypesConfigured ? '✓' : 'required'}</span><span>Room inventory {status.roomsConfigured ? '✓' : 'required'}</span></div>
      {status.operationallyReady ? <p role="status">Initial setup complete. <a href="/">Enter Hotel Command Center →</a></p> : <p>Configure at least one room type and room in the same property to complete initial setup.</p>}
      {!status.properties.length ? <p>No property found. Workspace bootstrap normally creates the first property; ask your administrator to restore it.</p> : <>
        <label>Property<select value={propertyId} onChange={event => setPropertyId(event.target.value)} disabled={mutating}>{status.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
        <h2>Room types</h2>
        {types.filter(type => type.propertyId === propertyId).length ? <ul>{types.filter(type => type.propertyId === propertyId).map(type => <li key={type.id}>{type.name} · {type.code}</li>)}</ul> : <p>No room types in this property yet.</p>}
        <form className="front-desk-form" onSubmit={event => void submit(event, `/room-types/properties/${propertyId}`, 'Room type created.')}><fieldset disabled={mutating}>
          <label>Name<input name="name" required minLength={2} maxLength={120} /></label><label>Code<input name="code" required maxLength={32} /></label><label>Maximum guests<input name="maxGuests" type="number" min={1} max={100} defaultValue={2} required /></label><button type="submit">{mutating ? 'Saving…' : 'Create room type'}</button>
        </fieldset></form>
        <h2>Rooms</h2>
        {rooms.filter(room => room.propertyId === propertyId).length ? <ul>{rooms.filter(room => room.propertyId === propertyId).map(room => <li key={room.id}>Room {room.number}</li>)}</ul> : <p>No rooms in this property yet.</p>}
        {types.some(type => type.propertyId === propertyId) ? <form className="front-desk-form" onSubmit={event => void submit(event, `/rooms/properties/${propertyId}`, 'Room created. Setup status refreshed.')}><fieldset disabled={mutating}>
          <label>Room type<select name="roomTypeId" value={roomTypeId} onChange={event => setRoomTypeId(event.target.value)} required>{types.filter(type => type.propertyId === propertyId).map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label>Room number<input name="number" required maxLength={32} /></label><button type="submit">{mutating ? 'Saving…' : 'Add room'}</button>
        </fieldset></form> : <p>Create a room type before adding rooms.</p>}
      </>}
    </> : <>
      <div className="setup-tabs"><button onClick={() => { setMode('create'); setError(null); }} disabled={mutating}>New hotel</button><button onClick={() => { setMode('login'); setError(null); }} disabled={mutating}>Sign in</button></div>
      {mode === 'create' ? <form className="front-desk-form" onSubmit={event => void submit(event, '/onboarding/workspace', 'Workspace created. Sign in normally to continue setup.')}><fieldset disabled={mutating}>
        <label>Your name<input name="name" autoComplete="name" required maxLength={120} /></label><label>Email<input name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} /></label><label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label><label>Hotel name<input name="hotelName" required maxLength={120} /></label><label>Hotel slug<input name="slug" placeholder="my-hotel" required minLength={3} maxLength={63} /><small>Letters, numbers and separating hyphens; normalized to lowercase.</small></label><label>First property name<input name="propertyName" required maxLength={120} /></label><label>Trial plan<select name="plan">{plans.map(plan => <option key={plan}>{plan}</option>)}</select></label><button type="submit">{mutating ? 'Creating…' : 'Create workspace'}</button>
      </fieldset></form> : <form className="front-desk-form" onSubmit={event => void submit(event, '/auth/login', 'Signed in. Continue initial setup.')}><fieldset disabled={mutating}>
        <label>Email<input name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label><button type="submit">{mutating ? 'Signing in…' : 'Sign in'}</button>
      </fieldset></form>}
      <p>Workspace creation starts a trial. No payment or Stripe subscription is created.</p>
    </>}
  </section></main>;
}
