import { Prisma } from '@prisma/client';
const { DATABASE_MARKER, DATABASE_ROLE, connectionSafety, emptyDatabase, syntheticGraph } = require('../../scripts/pilot01-safety.cjs');
const { MARKER } = require('../../scripts/pilot01.cjs');
const models = Prisma.dmmf.datamodel.models.map(model => model.name[0].toLowerCase() + model.name.slice(1));
function fixture() {
  const data: Record<string, any[]> = Object.fromEntries(models.map(name => [name, []]));
  const run = 'e23bc899-a08d-4e25-b786-57e542e166e4';
  data.property = [{ id: 'property-a', tenantId: 'pilot01-demo-a', name: `DEMO A ${run}`, timezone: 'America/Monterrey' }];
  data.roomType = [{ id: 'type-a', propertyId: 'property-a', name: 'DEMO King', code: 'DEMO-KING', maxGuests: 2 }];
  data.room = [{ id: 'room-a', propertyId: 'property-a', roomTypeId: 'type-a', number: '101' }];
  data.guest = [{ id: 'guest-a', tenantId: 'pilot01-demo-a', propertyId: 'property-a', roomId: null, firstName: 'DEMO', lastName: 'Guest A', email: `guest-a-${run}@pilot01.example.invalid`, phone: null, notes: null }];
  data.reservation = [{ id: 'res-a', tenantId: 'pilot01-demo-a', propertyId: 'property-a', guestId: 'guest-a', roomId: 'room-a', roomTypeId: 'type-a', confirmationCode: `DEMO-A-${run}`, notes: MARKER, totalAmount: null, adults: 1, children: 0 }];
  const tx: any = Object.fromEntries(models.map(name => [name, { findMany: jest.fn(async () => data[name]), count: jest.fn(async () => data[name].length) }]));
  return { tx, data };
}
describe('Pilot synthetic graph fail-closed guards', () => {
  it('accepts the original fixture graph without changing rows', async () => {
    const { tx, data } = fixture(); const before = JSON.stringify(data);
    await syntheticGraph(tx, MARKER); expect(JSON.stringify(data) === before).toBe(true);
  });
  it.each(['subscription', 'stripeCheckoutAttempt', 'stripeWebhookEvent', 'operationalStaff', 'guestPreference', 'guestTag', 'guestNote', 'operationsIncident'])('rejects out-of-scope %s rows, even with a DEMO tenant', async model => {
    const { tx, data } = fixture(); data[model].push({ tenantId: 'pilot01-demo-a' });
    await expect(syntheticGraph(tx, MARKER)).rejects.toThrow('DEMO_EXISTING_DATA_REJECTED');
  });
  it.each(models)('initial setup refuses a preexisting %s row', async model => {
    const { tx, data } = fixture(); for (const name of models) data[name] = []; data[model].push({ id: 'synthetic-sentinel' });
    await expect(emptyDatabase(tx)).rejects.toThrow('DEMO_EXISTING_DATA_REJECTED');
  });
  it('rejects unbound inventory that imitates a DEMO property name', async () => {
    const { tx, data } = fixture(); data.property.push({ ...data.property[0], id: 'unbound-property' });
    await expect(syntheticGraph(tx, MARKER)).rejects.toThrow('DEMO_EXISTING_DATA_REJECTED');
  });
});
describe('Pilot read-only PostgreSQL connection attestation', () => {
  const valid = { database: 'vantara_pilot01', role: DATABASE_ROLE, direct_login: true, replica: false, elevated: false, role_memberships: false, database_create: false, schema_create: false, owns_objects: false, marker: DATABASE_MARKER };
  it('accepts a limited direct role on the explicitly marked disposable database', async () => { await expect(connectionSafety({ $queryRaw: jest.fn().mockResolvedValue([valid]) })).resolves.toBeUndefined(); });
  it.each([{ role: 'admin' }, { database: 'another_database' }, { direct_login: false }, { replica: true }, { elevated: true }, { role_memberships: true }, { database_create: true }, { schema_create: true }, { owns_objects: true }, { marker: null }])('rejects unexpected server identity or privilege (%j)', async change => {
    await expect(connectionSafety({ $queryRaw: jest.fn().mockResolvedValue([{ ...valid, ...change }]) })).rejects.toThrow('DEMO_CONNECTION_REJECTED');
  });
  it('fails closed if no server identity is returned', async () => { await expect(connectionSafety({ $queryRaw: jest.fn().mockResolvedValue([]) })).rejects.toThrow('DEMO_CONNECTION_REJECTED'); });
});
