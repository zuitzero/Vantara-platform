export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 40 }}>
      <section style={{ maxWidth: 760 }}>
        <p style={{ opacity: 0.55, letterSpacing: '0.18em', textTransform: 'uppercase', fontSize: 12 }}>
          Vantara Platform · Foundation 001
        </p>
        <h1 style={{ fontSize: 'clamp(42px, 8vw, 88px)', lineHeight: 0.95, margin: '18px 0' }}>
          The operating system for connected hotels.
        </h1>
        <p style={{ maxWidth: 620, color: '#aab1b8', fontSize: 18, lineHeight: 1.6 }}>
          Foundation is online. Hotel Core, Vantara Connect and Vantara Intelligence will grow from this base.
        </p>
      </section>
    </main>
  );
}
