'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import './operations-center.css';

type BillingState = { plan: string; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; hasStripeCustomer: boolean; hasStripeSubscription: boolean };
export function BillingCenter({ base, onState }: { base: string; onState: (state: { plan: string; status: string }) => void }) {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [plan, setPlan] = useState('LOBBY'); const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); const [mutation, setMutation] = useState<string | null>(null);
  const generation = useRef(0); const stateCallback = useRef(onState); stateCallback.current = onState;
  const load = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError(null);
    try {
      const response = await fetch(`${base}/billing/reconcile`, { method: 'POST', credentials: 'include', cache: 'no-store' }); const data = await response.json();
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(' ') : data.message ?? 'Unable to load billing.');
      if (request === generation.current) { setBilling(data); setPlan(data.plan); stateCallback.current(data); }
    } catch (err) { if (request === generation.current) setError(err instanceof Error ? err.message : 'Unable to load billing.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [base]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const open = async (action: 'checkout' | 'portal') => {
    if (mutation) return; setMutation(action); setError(null);
    try {
      const response = await fetch(`${base}/billing/${action}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'checkout' ? { plan } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(' ') : data.message ?? 'Unable to open billing.');
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || url.hostname !== (action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com')) throw new Error('Invalid billing destination.');
      window.location.assign(url.toString());
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to open billing.'); setMutation(null); }
  };
  return <section className="ops-center">
    <div className="requests-hero"><div><span className="panel-kicker">HOTEL / BILLING</span><h2>Billing</h2><p>Your hotel subscription and secure billing management.</p></div><button className="refresh-button" onClick={() => void load()} disabled={loading || !!mutation}>Refresh billing</button></div>
    {error && <div className="request-error" role="alert">{error}<button onClick={() => void load()} disabled={loading || !!mutation}>Retry / refresh</button></div>}
    {loading ? <div className="request-empty">Loading subscription…</div> : !billing ? <div className="request-empty">Billing state is unavailable. Retry to load your hotel subscription.</div> : <article className="ops-card">
      <div className="ops-card-head"><h3>{billing.plan}</h3><span>{billing.status.replaceAll('_', ' ')}</span></div>
      <div className="request-meta"><span>CURRENT PERIOD END <b>{billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd).toLocaleDateString() : 'Not set'}</b></span><span>CANCELLATION <b>{billing.cancelAtPeriodEnd ? 'Scheduled at period end' : billing.status === 'CANCELED' ? 'Subscription ended' : 'Not scheduled'}</b></span></div>
      {!billing.hasStripeSubscription && billing.status === 'TRIALING' && <p>Internal hotel trial. Choosing a paid plan starts secure Checkout without adding another trial. Billing updates after verification; returning from Checkout does not confirm payment.</p>}
      {billing.hasStripeSubscription && <p>{billing.status === 'TRIALING' ? 'Stripe-backed trial.' : 'Subscription state verified by Stripe.'} Use Manage Billing for payment methods, billing history and cancellation. Plan changes depend on the configured billing portal.</p>}
      {billing.cancelAtPeriodEnd && <p>Cancellation is scheduled. Your hotel operations remain available.</p>}
      <div className="request-toolbar">
        {!billing.hasStripeSubscription && <><label htmlFor="billing-plan">Paid plan</label><select id="billing-plan" value={plan} onChange={event => setPlan(event.target.value)} disabled={!!mutation}>{['LOBBY', 'SUITE', 'GRAND'].map(option => <option key={option}>{option}</option>)}</select><button className="refresh-button" onClick={() => void open('checkout')} disabled={!!mutation}>{mutation === 'checkout' ? 'Opening Checkout…' : 'Choose paid plan'}</button></>}
        {billing.hasStripeCustomer && <button className="refresh-button" onClick={() => void open('portal')} disabled={!!mutation}>{mutation === 'portal' ? 'Opening billing…' : 'Manage Billing'}</button>}
      </div>
    </article>}
  </section>;
}
