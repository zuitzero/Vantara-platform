'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './crm-center.css';

type GuestSummary = {
  id: string; firstName: string; lastName: string; email: string | null; phone: string | null; status: string;
};
type CrmState = {
  guest: GuestSummary;
  tags: { id: string; label: string; createdAt: string }[];
  preferences: { id: string; key: string; value: string; updatedAt: string }[];
  notes: { id: string; body: string; createdAt: string; author: { name: string } | null }[];
  metrics: { reservations: number; completedStays: number; requests: number; completedRequests: number };
  timeline: { type: 'RESERVATION' | 'REQUEST' | 'NOTE'; id: string; occurredAt: string; title: string; status: string; detail: Record<string, unknown> }[];
};

const date = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function CrmCenter({ base }: { base: string }) {
  const [guests, setGuests] = useState<GuestSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const loadGuests = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${base}/guests`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load guest directory.');
      const items: GuestSummary[] = await response.json();
      if (!Array.isArray(items)) throw new Error('Invalid guest directory response.');
      if (request !== generation.current) return;
      setGuests(items);
      setSelected(current => items.some(item => item.id === current) ? current : items[0]?.id ?? null);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : 'Unable to load CRM.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [base]);
  useEffect(() => { void loadGuests(); return () => { generation.current++; }; }, [loadGuests]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return guests;
    return guests.filter(guest => [guest.firstName, guest.lastName, guest.email ?? '', guest.phone ?? ''].join(' ').toLowerCase().includes(needle));
  }, [guests, query]);

  return <section className="crm-center">
    <div className="requests-hero">
      <div><h2>CRM</h2><p>Guest profiles, preferences and stay history.</p></div>
      <button className="refresh-button" onClick={() => void loadGuests()} disabled={loading}>Refresh directory</button>
    </div>
    {error && <div className="request-error" role="alert">{error} <button className="refresh-button" onClick={() => void loadGuests()}>Retry directory</button></div>}
    <div className="crm-layout">
      <aside className="crm-directory">
        <label htmlFor="crm-search">Guest directory</label>
        <input id="crm-search" type="search" placeholder="Search guest" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="crm-directory-list">
          {filtered.map(guest => <button key={guest.id} aria-pressed={selected === guest.id} className={selected === guest.id ? 'active' : ''} onClick={() => setSelected(guest.id)}>
            <strong>{guest.firstName} {guest.lastName}</strong><span>{guest.email ?? guest.phone ?? 'No contact data'}</span>
          </button>)}
          {loading && <p role="status">Loading guest directory…</p>}
          {!loading && !error && filtered.length === 0 && <p>{guests.length ? 'No guests match this search.' : 'No guest profiles yet.'}</p>}
        </div>
      </aside>
      {selected && <CrmProfile key={selected} base={base} guestId={selected} />}
    </div>
  </section>;
}

function CrmProfile({ base, guestId }: { base: string; guestId: string }) {
  const [crm, setCrm] = useState<CrmState | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [preferenceDraft, setPreferenceDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const busy = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const endpoint = `${base}/guests/${encodeURIComponent(guestId)}/crm`;

  const load = useCallback(async () => {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(endpoint, { credentials: 'include', cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Unable to load guest CRM profile.');
      const data: CrmState = await response.json();
      if (request.signal.aborted) return;
      if (data.guest.id !== guestId) throw new Error('Unexpected guest CRM profile.');
      setCrm(data);
      setTagDraft(data.tags.map(tag => tag.label).join(', '));
      setPreferenceDraft(data.preferences.map(item => `${item.key}=${item.value}`).join('\n'));
    } catch (failure) {
      if (!request.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'Unable to load guest CRM profile.');
    } finally { if (!request.signal.aborted) setLoading(false); }
  }, [endpoint, guestId]);
  useEffect(() => { void load(); return () => pending.current?.abort(); }, [load]);

  const mutate = async (method: 'POST' | 'PATCH', payload: unknown) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(endpoint + (method === 'POST' ? '/notes' : ''), {
        method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(method === 'POST' ? 'Unable to add CRM note.' : 'Unable to save CRM profile.');
      if (pending.current?.signal.aborted) return;
      if (method === 'POST') setNoteDraft('');
      await load();
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Unable to save CRM changes.');
    } finally { busy.current = false; setSaving(false); }
  };

  const saveProfile = () => {
    const tags = tagDraft.split(',').map(value => value.trim()).filter(Boolean);
    const preferences = preferenceDraft.split('\n').flatMap(line => {
      const separator = line.indexOf('=');
      if (separator < 1) return [];
      const key = line.slice(0, separator).trim(), value = line.slice(separator + 1).trim();
      return key && value ? [{ key, value }] : [];
    });
    return mutate('PATCH', { tags, preferences });
  };

  return <div className="crm-profile">
    {loadError ? <div className="request-empty" role="alert"><strong>{loadError}</strong><button className="refresh-button" onClick={() => void load()}>Retry profile</button></div>
      : loading || !crm ? <div className="request-empty" role="status">Loading guest profile…</div>
      : <>
        {saveError && <div className="request-error" role="alert">{saveError}</div>}
        <div className="crm-profile-head">
          <div><span className="panel-kicker">GUEST PROFILE</span><h3>{crm.guest.firstName} {crm.guest.lastName}</h3><p>{crm.guest.email ?? 'No email'} · {crm.guest.phone ?? 'No phone'}</p></div>
          <span className="crm-status">{crm.guest.status}</span>
        </div>
        <div className="crm-metrics">
          <div><span>Reservations</span><strong>{crm.metrics.reservations}</strong></div>
          <div><span>Completed stays</span><strong>{crm.metrics.completedStays}</strong></div>
          <div><span>Requests</span><strong>{crm.metrics.requests}</strong></div>
          <div><span>Resolved requests</span><strong>{crm.metrics.completedRequests}</strong></div>
        </div>
        <div className="crm-editor-grid">
          <section className="crm-editor-card"><h4>Guest tags</h4><p>Comma-separated operational tags.</p><input aria-label="Guest tags" value={tagDraft} disabled={saving} onChange={event => setTagDraft(event.target.value)} placeholder="VIP, Repeat guest, Business" /></section>
          <section className="crm-editor-card"><h4>Preferences</h4><p>One preference per line using key=value.</p><textarea aria-label="Guest preferences" value={preferenceDraft} disabled={saving} onChange={event => setPreferenceDraft(event.target.value)} placeholder={'pillow=firm\nfloor=quiet\ncoffee=decaf'} /></section>
        </div>
        <button className="advance-button" disabled={saving} onClick={() => void saveProfile()}>{saving ? 'Saving…' : 'Save guest memory'}</button>
        <section className="crm-note-composer"><h4>Add CRM note</h4><textarea aria-label="New CRM note" value={noteDraft} disabled={saving} maxLength={2000} onChange={event => setNoteDraft(event.target.value)} placeholder="Context the next team member should know…" /><button className="refresh-button" disabled={saving || !noteDraft.trim()} onClick={() => void mutate('POST', { body: noteDraft.trim() })}>Add note</button></section>
        <section className="crm-timeline"><div className="crm-section-head"><h4>Guest timeline</h4><span>{crm.timeline.length} events</span></div>
          {crm.timeline.length === 0 ? <p>No history recorded yet.</p> : crm.timeline.map(item => <article key={`${item.type}-${item.id}`} className="crm-timeline-item">
            <div className="crm-event-mark">{item.type.slice(0, 1)}</div>
            <div><div className="crm-event-head"><strong>{item.title}</strong><span>{item.status.replaceAll('_', ' ')}</span></div><p>{date(item.occurredAt)}</p>
              {item.type === 'NOTE' && typeof item.detail.body === 'string' && <blockquote>{item.detail.body}</blockquote>}
            </div>
          </article>)}
        </section>
      </>}
  </div>;
}
