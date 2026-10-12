'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [crm, setCrm] = useState<CrmState | null>(null);
  const [query, setQuery] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [preferenceDraft, setPreferenceDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGuests = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`${base}/guests`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load guest directory.');
      const data = await response.json();
      const items = Array.isArray(data) ? data : [];
      setGuests(items);
      if (!selected && items[0]?.id) setSelected(items[0].id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load CRM.');
    } finally { setLoading(false); }
  }, [base, selected]);

  const loadCrm = useCallback(async (guestId: string) => {
    setError(null);
    const response = await fetch(`${base}/guests/${guestId}/crm`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load guest CRM profile.');
    const data = await response.json() as CrmState;
    setCrm(data);
    setTagDraft(data.tags.map(tag => tag.label).join(', '));
    setPreferenceDraft(data.preferences.map(item => `${item.key}=${item.value}`).join('\n'));
  }, [base]);

  useEffect(() => { void loadGuests(); }, [loadGuests]);
  useEffect(() => {
    if (!selected) { setCrm(null); return; }
    setCrm(null);
    void loadCrm(selected).catch(failure => setError(failure instanceof Error ? failure.message : 'Unable to load guest CRM profile.'));
  }, [selected, loadCrm]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return guests;
    return guests.filter(guest => [guest.firstName, guest.lastName, guest.email ?? '', guest.phone ?? ''].join(' ').toLowerCase().includes(needle));
  }, [guests, query]);

  const saveProfile = async () => {
    if (!selected) return;
    setSaving(true); setError(null);
    try {
      const tags = tagDraft.split(',').map(value => value.trim()).filter(Boolean);
      const preferences = preferenceDraft.split('\n').map(line => {
        const separator = line.indexOf('=');
        return separator < 1 ? null : { key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
      }).filter((item): item is { key: string; value: string } => !!item?.key && !!item.value);
      const response = await fetch(`${base}/guests/${selected}/crm`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, preferences }),
      });
      if (!response.ok) throw new Error('Unable to save CRM profile.');
      await loadCrm(selected);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save CRM profile.');
    } finally { setSaving(false); }
  };

  const addNote = async () => {
    if (!selected || !noteDraft.trim()) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`${base}/guests/${selected}/crm/notes`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteDraft.trim() }),
      });
      if (!response.ok) throw new Error('Unable to add CRM note.');
      setNoteDraft('');
      await loadCrm(selected);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to add CRM note.');
    } finally { setSaving(false); }
  };

  return <section className="crm-center">
    <div className="requests-hero">
      <div><span className="panel-kicker">HOTEL / GUEST INTELLIGENCE</span><h2>CRM</h2><p>Guest memory built from stays, requests, preferences and human context.</p></div>
      <button className="refresh-button" onClick={() => void loadGuests()} disabled={loading || saving}>{loading ? 'Syncing…' : 'Refresh CRM'}</button>
    </div>
    {error && <div className="request-error" role="alert">{error}</div>}
    <div className="crm-layout">
      <aside className="crm-directory">
        <label htmlFor="crm-search">Guest directory</label>
        <input id="crm-search" type="search" placeholder="Search guest" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="crm-directory-list">
          {filtered.map(guest => <button key={guest.id} className={selected === guest.id ? 'active' : ''} onClick={() => setSelected(guest.id)}>
            <strong>{guest.firstName} {guest.lastName}</strong><span>{guest.email ?? guest.phone ?? 'No contact data'}</span>
          </button>)}
          {!loading && filtered.length === 0 && <p>No guests match this search.</p>}
        </div>
      </aside>
      <div className="crm-profile">
        {!selected ? <div className="request-empty">Select a guest to open their CRM profile.</div>
          : !crm ? <div className="request-empty"><span className="loading-orb" />Loading guest memory…</div>
          : <>
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
              <section className="crm-editor-card"><h4>Guest tags</h4><p>Comma-separated operational tags.</p><input value={tagDraft} onChange={event => setTagDraft(event.target.value)} placeholder="VIP, Repeat guest, Business" /></section>
              <section className="crm-editor-card"><h4>Preferences</h4><p>One preference per line using key=value.</p><textarea value={preferenceDraft} onChange={event => setPreferenceDraft(event.target.value)} placeholder={'pillow=firm\nfloor=quiet\ncoffee=decaf'} /></section>
            </div>
            <button className="advance-button" disabled={saving} onClick={() => void saveProfile()}>{saving ? 'Saving…' : 'Save guest memory'}</button>
            <section className="crm-note-composer"><h4>Add CRM note</h4><textarea value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="Context the next team member should know…" /><button className="refresh-button" disabled={saving || !noteDraft.trim()} onClick={() => void addNote()}>Add note</button></section>
            <section className="crm-timeline"><div className="crm-section-head"><h4>Guest timeline</h4><span>{crm.timeline.length} events</span></div>
              {crm.timeline.length === 0 ? <p>No history recorded yet.</p> : crm.timeline.map(item => <article key={`${item.type}-${item.id}`} className="crm-timeline-item">
                <div className="crm-event-mark">{item.type.slice(0, 1)}</div>
                <div><div className="crm-event-head"><strong>{item.title}</strong><span>{item.status.replaceAll('_', ' ')}</span></div><p>{date(item.occurredAt)}</p>
                  {item.type === 'NOTE' && typeof item.detail.body === 'string' && <blockquote>{item.detail.body}</blockquote>}
                </div>
              </article>)}
            </section>
          </>}
      </div>
    </div>
  </section>;
}
