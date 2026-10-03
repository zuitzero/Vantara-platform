'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import './front-desk-forms.css';

type Identity = { id: string; role: string; user: { name: string } };
type Profile = { id: string; membershipId: string; membership: Identity; department: string; operationalStatus: string; propertyId: string | null; property: { name: string } | null };
const departments = ['FRONT_DESK', 'HOUSEKEEPING', 'MAINTENANCE', 'MANAGEMENT'];
async function message(response: Response) {
  const data = await response.json().catch(() => null);
  return Array.isArray(data?.message) ? data.message.join(' ') : data?.message ?? `Request failed (${response.status}).`;
}

export function StaffCenter({ base }: { base: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [memberships, setMemberships] = useState<Identity[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const data = await Promise.all(['staff', 'staff/memberships', 'properties'].map(async path => {
        const response = await fetch(`${base}/${path}`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(await message(response));
        const records = await response.json();
        if (!Array.isArray(records)) throw new Error('Invalid staff data response.');
        return records;
      }));
      if (request === generation.current) { setProfiles(data[0]); setMemberships(data[1]); setProperties(data[2]); setError(null); }
    } catch (failure) { if (request === generation.current) setError(failure instanceof Error ? failure.message : 'Staff unavailable.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [base]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || busy.current) return;
    busy.current = true;
    const data = new FormData(event.currentTarget);
    const field = (key: string) => String(data.get(key) ?? '');
    const body = { department: field('department'), operationalStatus: field('operationalStatus'), propertyId: field('propertyId') || null, ...(editing === 'new' ? { membershipId: field('membershipId') } : {}) };
    setSaving(true); setMutationError(null);
    try {
      const response = await fetch(`${base}/staff${editing === 'new' ? '' : '/' + encodeURIComponent(editing.id)}`, {
        method: editing === 'new' ? 'POST' : 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await message(response));
      setEditing(null);
      await load();
    } catch (failure) { setMutationError(failure instanceof Error ? failure.message : 'Staff update failed.'); }
    finally { busy.current = false; setSaving(false); }
  };
  return <section className="staff-center">
    <div className="requests-hero"><div><span className="panel-kicker">HOTEL OPERATIONS / PEOPLE</span><h2>Staff</h2><p>Operational profiles linked to existing hotel memberships.</p></div><div className="front-desk-actions"><button className="advance-button" disabled={loading || !!error || saving} onClick={() => { setEditing('new'); setMutationError(null); }}>Create staff profile</button><button className="refresh-button" disabled={loading || saving} onClick={() => void load()}>Refresh</button></div></div>
    {editing && <section className="front-desk-form"><h3>{editing === 'new' ? 'Create operational profile' : editing.membership.user.name}</h3>
      <form key={editing === 'new' ? 'new' : editing.id} onSubmit={event => void save(event)}><fieldset disabled={saving}>
        {editing === 'new' && <label>Existing hotel membership<select name="membershipId" required><option value="">Select member</option>{memberships.map(member => <option key={member.id} value={member.id}>{member.user.name} · {member.role}</option>)}</select>{memberships.length === 0 && <small>No eligible memberships without a profile. This view does not create user accounts or change roles.</small>}</label>}
        <label>Department<select name="department" defaultValue={editing === 'new' ? 'FRONT_DESK' : editing.department}>{departments.map(department => <option key={department}>{department}</option>)}</select></label>
        <label>Operational status<select name="operationalStatus" defaultValue={editing === 'new' ? 'ACTIVE' : editing.operationalStatus}><option>ACTIVE</option><option>INACTIVE</option></select></label>
        <label>Property scope<select name="propertyId" defaultValue={editing === 'new' ? '' : editing.propertyId ?? ''}><option value="">All hotel properties</option>{properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
      </fieldset>{mutationError && <p className="request-error" role="alert">{mutationError}</p>}<div className="front-desk-actions"><button className="advance-button" disabled={saving || (editing === 'new' && memberships.length === 0)}>{saving ? 'Saving…' : 'Save profile'}</button><button type="button" className="refresh-button" disabled={saving} onClick={() => setEditing(null)}>Cancel</button></div></form>
    </section>}
    {loading ? <div className="request-empty" role="status"><strong>Loading hotel staff…</strong></div> : error ? <div className="request-empty" role="alert"><strong>Staff unavailable</strong><span>{error}</span><button className="refresh-button" onClick={() => void load()}>Retry</button></div>
      : profiles.length === 0 ? <div className="request-empty"><strong>No operational staff profiles</strong><span>Create a profile for an existing hotel member.</span></div>
        : <div className="request-list">{profiles.map(profile => <article className="request-card" key={profile.id}><div className="request-card-main"><h3>{profile.membership.user.name}</h3><div className="request-meta"><span>ROLE <b>{profile.membership.role}</b></span><span>DEPARTMENT <b>{profile.department}</b></span><span>PROPERTY <b>{profile.property?.name ?? 'All hotel properties'}</b></span><span>STATUS <b>{profile.operationalStatus}</b></span></div></div><button className="advance-button" disabled={saving} onClick={() => { setEditing(profile); setMutationError(null); }}>Edit profile</button></article>)}</div>}
  </section>;
}
