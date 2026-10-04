'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import './operations-center.css';

type Entry = { id: string; createdAt: string; actorType: string; actorUser: { name: string } | null; action: string; resourceType: string; resourceId: string | null; success: boolean; metadata: { status?: string; previousStatus?: string; blocksRoom?: boolean; department?: string; operationalStatus?: string } };
export function AuditCenter({ base }: { base: string }) {
  const [offset, setOffset] = useState(0); const [items, setItems] = useState<Entry[]>([]); const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError(null);
    try {
      const response = await fetch(`${base}/audit?offset=${offset}&limit=25`, { credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(' ') : data.message ?? 'Unable to load activity.');
      if (request === generation.current) { setItems(data.items); setHasMore(data.hasMore); }
    } catch (err) { if (request === generation.current) setError(err instanceof Error ? err.message : 'Unable to load activity.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [base, offset]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  return <section className="ops-center"><div className="requests-hero"><div><span className="panel-kicker">HOTEL / AUDIT</span><h2>Activity</h2><p>Recorded operational actions in your active hotel.</p></div><button className="refresh-button" onClick={() => void load()} disabled={loading}>Refresh</button></div>
    {error ? <div className="request-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div> : loading ? <div className="request-empty">Loading activity…</div> : !items.length ? <div className="request-empty">No recorded activity in this view.</div> : <div className="ops-grid">{items.map(entry => <article className="ops-card" key={entry.id}><div className="ops-card-head"><h3>{entry.action.replaceAll('_', ' ')}</h3><span>{entry.success ? 'Success' : 'Denied / failed'}</span></div><div className="request-meta"><span>WHEN <b>{new Date(entry.createdAt).toLocaleString()}</b></span><span>ACTOR <b>{entry.actorUser?.name ?? entry.actorType}</b></span><span>RESOURCE <b>{entry.resourceType} · {entry.resourceId ?? '—'}</b></span></div><p>{entry.metadata.status ? `${entry.metadata.previousStatus ?? ''} → ${entry.metadata.status}` : entry.metadata.blocksRoom !== undefined ? entry.metadata.blocksRoom ? 'Room blocking enabled' : 'Room blocking disabled' : entry.metadata.operationalStatus ?? entry.metadata.department ?? 'Recorded server-side action'}</p></article>)}</div>}
    <div className="request-toolbar"><button className="refresh-button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 25))}>Previous</button><span>Page {offset / 25 + 1}</span><button className="refresh-button" disabled={loading || !hasMore || offset >= 10000} onClick={() => setOffset(value => value + 25)}>Next</button></div>
  </section>;
}
