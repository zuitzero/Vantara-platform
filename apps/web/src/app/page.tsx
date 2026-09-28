'use client';

import { useState } from 'react';

const nav = ['Overview', 'Rooms', 'Guests', 'Reservations', 'Requests', 'Staff', 'Finance', 'Settings'];
const bars = [38, 54, 47, 66, 58, 72, 64, 81, 69, 88, 76, 94, 84, 91];

export default function Home() {
  const [active, setActive] = useState('Overview');

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="brand">VANTARA<span> /</span></div>
        <div className="hotel-card">
          <div className="eyebrow">Active property</div>
          <div className="hotel-name">Hotel Aurora</div>
          <div className="plan">SUITE · ACTIVE</div>
        </div>
        <nav className="nav" aria-label="Workspace navigation">
          {nav.map((item) => (
            <button key={item} className={active === item ? 'active' : ''} onClick={() => setActive(item)}>
              {item}
            </button>
          ))}
        </nav>
        <div className="user">
          <div className="eyebrow">Signed in as</div>
          <div className="user-name">Adrien</div>
          <div className="user-role">Owner</div>
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{active}</div>
            <h1>Good morning, Adrien.</h1>
            <div className="subtitle">Here is what is happening across Hotel Aurora today.</div>
          </div>
          <div className="status"><span className="dot" /> Vantara systems operational</div>
        </header>

        <section className="metrics" aria-label="Hotel performance">
          <Metric label="Occupancy" value="82.4%" change="↑ 5.7%" />
          <Metric label="Revenue" value="$428,650" change="↑ 12.8%" />
          <Metric label="Reservations" value="486" change="↑ 8.4%" />
          <Metric label="Open requests" value="07" change="↓ 18.2%" down />
        </section>

        <section className="grid">
          <div className="card">
            <div className="card-title">Revenue & occupancy</div>
            <div className="card-meta">Last 14 days · MXN</div>
            <div className="chart" aria-label="Revenue trend visualization">
              {bars.map((height, index) => <div className="bar" key={index} style={{ height: `${height}%` }} />)}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Today</div>
            <div className="card-meta">September 28, 2026</div>
            <div className="request"><div><strong>Check-ins</strong><small>Expected arrivals</small></div><span className="badge">24</span></div>
            <div className="request"><div><strong>Check-outs</strong><small>Departures</small></div><span className="badge">17</span></div>
            <div className="request"><div><strong>Rooms cleaning</strong><small>Housekeeping queue</small></div><span className="badge">08</span></div>
            <div className="request"><div><strong>Open requests</strong><small>Guest operations</small></div><span className="badge">07</span></div>
          </div>
        </section>

        <section className="grid section">
          <div className="card">
            <div className="card-title">Recent guest requests</div>
            <div className="card-meta">Live operational queue</div>
            <div className="request"><div><strong>Extra towels · Room 407</strong><small>Housekeeping · 4 min ago</small></div><span className="badge">OPEN</span></div>
            <div className="request"><div><strong>AC inspection · Room 214</strong><small>Maintenance · 11 min ago</small></div><span className="badge">ASSIGNED</span></div>
            <div className="request"><div><strong>Room service · Room 508</strong><small>Food & beverage · 18 min ago</small></div><span className="badge">IN PROGRESS</span></div>
          </div>

          <div className="card insight">
            <div className="card-title">Vantara Insight</div>
            <div className="card-meta">Performance signal</div>
            <p><span className="accent">Revenue is trending +12.8%.</span> The current increase is aligned with stronger weekend occupancy. This panel will later be powered by Vantara Intelligence using the hotel’s real operating data.</p>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, change, down = false }: { label: string; value: string; change: string; down?: boolean }) {
  return <div className="card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className={`change ${down ? 'down' : 'up'}`}>{change} vs previous period</div></div>;
}
