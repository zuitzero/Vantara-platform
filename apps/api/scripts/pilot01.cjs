// Local synthetic fixtures only. Never imported by the application or a public route.
const { PrismaClient } = require('@prisma/client');
const { randomBytes, randomUUID, scryptSync, createHash, timingSafeEqual } = require('node:crypto');
const MARKER = 'VANTARA_PILOT01_SYNTHETIC_V1';
const ids = side => ({ tenant: `pilot01-demo-${side}`, user: `pilot01-admin-${side}`, email: `admin-${side}@pilot01.example.invalid`, name: `DEMO Pilot 01 Hotel ${side.toUpperCase()}` });
function configuration(env) {
  if (!['development', 'test'].includes(env.NODE_ENV) || env.PILOT01_DEMO !== 'synthetic-local-only') throw new Error('DEMO_ENV_REQUIRED');
  let url; try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DEMO_DATABASE_REQUIRED'); }
  if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/vantara_pilot01' || [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) throw new Error('DEMO_DATABASE_REJECTED');
  if (!env.PILOT01_PASSWORD || env.PILOT01_PASSWORD.length < 16 || env.PILOT01_PASSWORD.length > 128) throw new Error('DEMO_PASSWORD_REQUIRED');
  if (Object.entries(env).some(([key, value]) => /^STRIPE_/.test(key) && value)) throw new Error('DEMO_EXTERNAL_BILLING_FORBIDDEN');
  return { url: url.toString(), password: env.PILOT01_PASSWORD };
}
function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(scryptSync(password, salt, 64)).digest('hex');
  return `scrypt:${salt}:${hash}`;
}
function matches(password, hash) {
  const [algorithm, salt, digest] = hash.split(':');
  if (algorithm !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex'); const actual = createHash('sha256').update(scryptSync(password, salt, 64)).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function provision(db, command, password, now = new Date()) {
  if (!['setup', 'reset'].includes(command)) throw new Error('DEMO_COMMAND_REJECTED');
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(350135)`;
    const tenants = await tx.tenant.findMany({ include: { memberships: { include: { user: true } } } });
    const users = await tx.user.findMany();
    if (tenants.length || users.length) {
      if (tenants.length !== 2 || users.length !== 2 || !['a', 'b'].every(side => {
        const fixture = ids(side); const tenant = tenants.find(row => row.id === fixture.tenant); const user = users.find(row => row.id === fixture.user);
        return tenant?.name === fixture.name && tenant.slug === fixture.tenant && tenant.type === 'HOTEL' && tenant.memberships.length === 1 && tenant.memberships[0].userId === fixture.user && tenant.memberships[0].role === 'HOTEL_ADMIN' && user?.email === fixture.email && matches(password, user.passwordHash);
      })) throw new Error('DEMO_EXISTING_DATA_REJECTED');
      if (await tx.reservation.count({ where: { notes: { not: MARKER } } }) || await tx.reservation.count({ where: { notes: null } })) throw new Error('DEMO_EXISTING_DATA_REJECTED');
      if (command === 'setup') return { created: false };
    } else {
      // Refuse partial or unrelated fixture data; never adopt/overwrite it.
      for (const model of ['property', 'roomType', 'room', 'guest', 'reservation', 'guestRequest', 'notification', 'session', 'auditLog', 'stripeWebhookEvent']) {
        if (await tx[model].count()) throw new Error('DEMO_EXISTING_DATA_REJECTED');
      }
      for (const side of ['a', 'b']) {
        const fixture = ids(side);
        await tx.tenant.create({ data: { id: fixture.tenant, slug: fixture.tenant, name: fixture.name, type: 'HOTEL', memberships: { create: { role: 'HOTEL_ADMIN', user: { create: { id: fixture.user, email: fixture.email, name: `DEMO Administrator ${side.toUpperCase()}`, passwordHash: passwordHash(password) } } } } } });
      }
    }
    // Reset archives rather than deletes: revoke old guest links and create a new
    // independent stay/room. Existing requests/history/reservations are retained.
    await tx.guestConnectAccess.updateMany({ where: { tenantId: { in: ['pilot01-demo-a', 'pilot01-demo-b'] }, reservation: { notes: MARKER } }, data: { revokedAt: now } });
    const run = randomUUID();
    for (const side of ['a', 'b']) {
      const tenantId = ids(side).tenant;
      const property = await tx.property.create({ data: { tenantId, name: `DEMO ${side.toUpperCase()} ${run}` } });
      const type = await tx.roomType.create({ data: { propertyId: property.id, name: 'DEMO King', code: 'DEMO-KING' } });
      const room = await tx.room.create({ data: { propertyId: property.id, roomTypeId: type.id, number: '101', occupancyStatus: 'VACANT', readinessStatus: 'READY' } });
      const guest = await tx.guest.create({ data: { tenantId, propertyId: property.id, firstName: 'DEMO', lastName: `Guest ${side.toUpperCase()}`, email: `guest-${side}-${run}@pilot01.example.invalid` } });
      await tx.reservation.create({ data: { tenantId, propertyId: property.id, roomTypeId: type.id, roomId: room.id, guestId: guest.id, confirmationCode: `DEMO-${side.toUpperCase()}-${run}`, status: 'CONFIRMED', checkIn: now, checkOut: new Date(now.getTime() + 2 * 86400000), adults: 1, children: 0, notes: MARKER } });
    }
    return { created: true };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}
async function main() {
  let db;
  try {
    const config = configuration(process.env);
    const command = process.argv[2]; if (!['setup', 'reset'].includes(command)) throw new Error('DEMO_COMMAND_REJECTED');
    db = new PrismaClient({ datasources: { db: { url: config.url } } });
    const result = await provision(db, command, config.password);
    console.log(result.created ? 'Synthetic Pilot 01 ready. Sign in normally; use the latest DEMO reservation in hotel A.' : 'Synthetic Pilot 01 already exists. No data or credentials changed; use reset for a new stay.');
  } catch {
    // DB/provider errors can contain URLs or parameters. Never print their object.
    console.error('Pilot 01 refused or failed safely. Check the documented local-only environment, password, migrations and empty/owned database requirements.');
    process.exitCode = 1;
  } finally { await db?.$disconnect(); }
}
if (require.main === module) void main();
module.exports = { configuration, provision, ids, MARKER };
