// Fail closed: provenance checks for the existing Pilot fixture format, no schema changes.
const { Prisma } = require('@prisma/client');
const DATABASE_MARKER = 'VANTARA_PILOT01_LOCAL_SYNTHETIC_ONLY';
const DATABASE_ROLE = 'vantara_pilot01_demo';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const allowed = new Set(['tenant', 'user', 'membership', 'property', 'roomType', 'room', 'guest', 'reservation', 'guestConnectAccess', 'guestRequest', 'housekeepingTask', 'maintenanceTicket', 'notification', 'notificationRead', 'session', 'auditLog']);
const modelNames = Prisma.dmmf.datamodel.models.map(model => model.name[0].toLowerCase() + model.name.slice(1));
function requireDemo(condition) { if (!condition) throw new Error('DEMO_EXISTING_DATA_REJECTED'); }
async function connectionSafety(tx) {
  const rows = await tx.$queryRaw`
    SELECT current_database()::text AS database, current_user::text AS role,
      session_user = current_user AS direct_login,
      pg_is_in_recovery() AS replica,
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS elevated,
      EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS role_memberships,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relowner = r.oid) AS owns_objects,
      shobj_description(d.oid, 'pg_database') AS marker
    FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
    WHERE r.rolname = current_user`;
  const row = rows[0];
  if (rows.length !== 1 || row.database !== 'vantara_pilot01' || row.role !== DATABASE_ROLE || !row.direct_login || row.replica || row.elevated || row.role_memberships || row.database_create || row.schema_create || row.owns_objects || row.marker !== DATABASE_MARKER) {
    throw new Error('DEMO_CONNECTION_REJECTED');
  }
}
async function emptyDatabase(tx) {
  for (const model of modelNames) requireDemo(await tx[model].count() === 0);
}
async function syntheticGraph(tx, marker) {
  const data = {};
  for (const model of modelNames) {
    if (!allowed.has(model)) { requireDemo(await tx[model].count() === 0); continue; }
    data[model] = await tx[model].findMany();
  }
  const map = model => new Map(data[model].map(row => [row.id, row]));
  const properties = map('property'); const types = map('roomType'); const rooms = map('room');
  const guests = map('guest'); const reservations = map('reservation'); const requests = map('guestRequest');
  const tasks = map('housekeepingTask'); const tickets = map('maintenanceTicket'); const notifications = map('notification');
  const side = tenantId => ({ 'pilot01-demo-a': 'a', 'pilot01-demo-b': 'b' })[tenantId];
  const same = (row, tenantId) => !!row && row.tenantId === tenantId && !!side(tenantId);
  const runs = new Map();
  for (const property of properties.values()) {
    const letter = side(property.tenantId);
    const match = new RegExp(`^DEMO ${letter?.toUpperCase()} (${UUID})$`).exec(property.name);
    requireDemo(letter && match && property.timezone === 'America/Monterrey'); runs.set(property.id, match[1]);
  }
  for (const type of types.values()) requireDemo(properties.has(type.propertyId) && type.name === 'DEMO King' && type.code === 'DEMO-KING' && type.maxGuests === 2);
  for (const room of rooms.values()) requireDemo(properties.has(room.propertyId) && types.get(room.roomTypeId)?.propertyId === room.propertyId && room.number === '101');
  for (const guest of guests.values()) {
    const property = properties.get(guest.propertyId); const letter = side(guest.tenantId);
    requireDemo(same(property, guest.tenantId) && guest.firstName === 'DEMO' && guest.lastName === `Guest ${letter?.toUpperCase()}` && guest.email === `guest-${letter}-${runs.get(guest.propertyId)}@pilot01.example.invalid` && guest.phone === null && guest.notes === null && (!guest.roomId || rooms.get(guest.roomId)?.propertyId === guest.propertyId));
  }
  for (const reservation of reservations.values()) {
    const property = properties.get(reservation.propertyId); const guest = guests.get(reservation.guestId); const room = rooms.get(reservation.roomId);
    requireDemo(same(property, reservation.tenantId) && same(guest, reservation.tenantId) && guest.propertyId === reservation.propertyId && room?.propertyId === reservation.propertyId && room.roomTypeId === reservation.roomTypeId && reservation.notes === marker && reservation.confirmationCode === `DEMO-${side(reservation.tenantId).toUpperCase()}-${runs.get(reservation.propertyId)}` && reservation.totalAmount === null && reservation.adults === 1 && reservation.children === 0);
  }
  // Exactly one fixture inventory/stay per property, including older reset runs.
  for (const property of properties.values()) for (const model of ['roomType', 'room', 'guest', 'reservation']) requireDemo(data[model].filter(row => row.propertyId === property.id).length === 1);
  for (const request of requests.values()) {
    const reservation = reservations.get(request.reservationId);
    requireDemo(same(reservation, request.tenantId) && request.guestId === reservation.guestId && request.propertyId === reservation.propertyId && request.roomId === reservation.roomId && request.title.startsWith('DEMO ') && (!request.resolutionNote || request.resolutionNote.startsWith('DEMO ')));
  }
  for (const [model, category] of [['housekeepingTask', 'HOUSEKEEPING'], ['maintenanceTicket', 'MAINTENANCE']]) for (const work of data[model]) {
    requireDemo(!work.blocksRoom && work.assignedTo === null && work.assignedStaffId === null);
    requireDemo(data.guestRequest.some(request => same(request, work.tenantId) && request.category === category && request.roomId === work.roomId && request.propertyId === work.propertyId && request.title === work.title && (model === 'housekeepingTask' ? work.notes === `Guest request ${request.id}: ${request.message}` : work.description === request.message)));
    if (model === 'maintenanceTicket') requireDemo(!work.resolutionNote || work.resolutionNote.startsWith('DEMO '));
  }
  for (const access of data.guestConnectAccess) requireDemo(same(reservations.get(access.reservationId), access.tenantId) && /^[0-9a-f]{64}$/.test(access.tokenHash));
  const userTenant = userId => ({ 'pilot01-admin-a': 'pilot01-demo-a', 'pilot01-admin-b': 'pilot01-demo-b' })[userId];
  for (const session of data.session) requireDemo(userTenant(session.userId) === session.activeTenantId && /^[0-9a-f]{64}$/.test(session.tokenHash));
  const messages = { acknowledged: 'The hotel has received your request.', in_progress: 'The hotel is currently handling your request.', completed: 'Your request has been completed.', cancelled: 'Your request has been cancelled.' };
  for (const notification of notifications.values()) {
    const request = requests.get(notification.metadata?.requestId); const event = notification.type.replace('guest_request.', '');
    requireDemo(same(request, notification.tenantId) && notification.channel === 'IN_APP' && notification.type.startsWith('guest_request.'));
    requireDemo(notification.metadata.guestId === undefined || notification.metadata.guestId === request.guestId);
    requireDemo(notification.metadata.roomId === undefined || notification.metadata.roomId === request.roomId);
    if (event === 'created') requireDemo(notification.audience === 'HOTEL' && notification.recipientId === null && notification.title === 'New guest request' && notification.message === request.title);
    else if (event === 'received') requireDemo(notification.audience === 'GUEST' && notification.recipientId === request.guestId && notification.title === 'Request received' && notification.message === 'Your request has been sent to the hotel.');
    else requireDemo(notification.audience === 'GUEST' && notification.recipientId === request.guestId && notification.title === 'Request updated' && messages[event] !== undefined && notification.message === messages[event]);
  }
  for (const read of data.notificationRead) requireDemo(same(notifications.get(read.notificationId), read.tenantId) && userTenant(read.userId) === read.tenantId);
  const resources = { reservation: reservations, guest: guests, housekeeping: tasks, maintenance: tickets, property: properties };
  for (const audit of data.auditLog) {
    requireDemo(side(audit.tenantId) && (audit.actorUserId ? userTenant(audit.actorUserId) === audit.tenantId && audit.actorType === 'USER' : audit.actorType === 'SYSTEM'));
    if (audit.resourceType === 'authorization') requireDemo(audit.resourceId === null && audit.action === 'PERMISSION_DENIED');
    else if (audit.resourceType === 'room') requireDemo(properties.get(rooms.get(audit.resourceId)?.propertyId)?.tenantId === audit.tenantId);
    else requireDemo(same(resources[audit.resourceType]?.get(audit.resourceId), audit.tenantId));
    for (const key of ['roomId', 'previousRoomId']) if (audit.metadata?.[key]) requireDemo(properties.get(rooms.get(audit.metadata[key])?.propertyId)?.tenantId === audit.tenantId);
    if (audit.metadata?.propertyId) requireDemo(same(properties.get(audit.metadata.propertyId), audit.tenantId));
  }
}
module.exports = { dataModels: allowed, DATABASE_MARKER, DATABASE_ROLE, connectionSafety, emptyDatabase, syntheticGraph };
