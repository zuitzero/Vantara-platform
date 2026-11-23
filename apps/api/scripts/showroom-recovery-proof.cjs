// Called only after the disposable Showroom suite stopped all application listeners.
// Creates a NEW recovery database; never resets, drops or restores over the source.
const { PrismaClient, Prisma } = require('@prisma/client');
const { randomBytes, createHash, createCipheriv, createDecipheriv } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PostgresGuestAccessRepository, SHOWROOM_GUEST_POLICY } = require('../dist/connect/persistence/guest-access.repository');
const { verifyShowroomDatabase } = require('../dist/security/showroom-security');
const { MARKER } = require('../../../infra/staging/showroom-policy.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const fresh = () => hash(randomBytes(32));
function check(ok, id) { if (!ok) throw new Error(id); }
async function denied(run, id) { let rejected = false; try { await run(); } catch { rejected = true; } check(rejected, id); }
function docker(container, args, password, input) {
  const result = spawnSync('docker', ['exec', ...(input ? ['-i'] : []), '-e', 'PGPASSWORD', container, ...args], {
    env: { ...process.env, PGPASSWORD: password }, input, stdio: 'pipe', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  check(!result.error && result.status === 0, 'RECOVERY_COMMAND_FAILED'); return result.stdout;
}
async function fingerprint(db) {
  const values = [];
  for (const model of Prisma.dmmf.datamodel.models) {
    const delegate = model.name[0].toLowerCase() + model.name.slice(1);
    values.push([model.name, (await db[delegate].findMany()).map(row => JSON.stringify(row)).sort()]);
  }
  const migrations = await db.$queryRawUnsafe('SELECT * FROM _prisma_migrations ORDER BY id');
  return hash(JSON.stringify([values, migrations]));
}
async function rehearse(sourceUrl) {
  const url = new URL(sourceUrl), container = process.env.SHOWROOM_POSTGRES_CONTAINER;
  check(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' && /^[a-f0-9]{12,64}$/.test(container ?? '') &&
    url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.pathname === '/vantara_showroom' &&
    url.search === '?schema=public' && !url.hash, 'RECOVERY_TARGET_REJECTED');
  const source = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  let restored, encrypted, dump; const key = randomBytes(32), nonce = randomBytes(12);
  const backupRole = 'vantara_showroom_backup', recoveryRole = 'vantara_showroom_recovery';
  const backupPassword = randomBytes(32).toString('hex'), recoveryPassword = randomBytes(32).toString('hex');
  const target = 'vantara_showroom_restore';
  const started = Date.now();
  try {
    const [identity] = await source.$queryRawUnsafe("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
    check(identity?.marker === MARKER, 'RECOVERY_SOURCE_MARKER');
    const member = await source.membership.findFirst({ where: { role: 'HOTEL_STAFF', tenant: { type: 'HOTEL' } } });
    check(member, 'RECOVERY_OPERATOR_MISSING');
    const stay = await source.reservation.findFirst({ where: { tenantId: member.tenantId, status: 'CONFIRMED' } });
    check(stay, 'RECOVERY_STAY_MISSING');
    const oldStaff = fresh();
    await source.session.create({ data: { userId: member.userId, activeTenantId: member.tenantId, tokenHash: oldStaff, expiresAt: new Date(Date.now() + 3600000) } });
    const operator = { userId: member.userId, tenantId: member.tenantId, sessionHash: oldStaff };
    const repository = new PostgresGuestAccessRepository(source, SHOWROOM_GUEST_POLICY, 'showroom-proof');
    const oldGuest = fresh(), codes = [], reservations = [];
    for (let i = 0; i < 2; i++) {
      const r = await source.reservation.create({ data: { tenantId: stay.tenantId, propertyId: stay.propertyId,
        guestId: stay.guestId, roomTypeId: stay.roomTypeId, status: 'CONFIRMED',
        confirmationCode: 'SYNTHETIC-RECOVERY-' + randomBytes(8).toString('hex'),
        checkIn: new Date(Date.now() - 1000), checkOut: new Date(Date.now() + 86400000) } });
      reservations.push(r.id); const codeHash = fresh(); codes.push(codeHash);
      await repository.manageShowroomAdmission(operator, r.id, { codeHash, rootHash: fresh() });
      if (i === 0) await repository.exchangeOnce({ codeHash, freshSessionHash: oldGuest });
    }
    await repository.checkSession(oldGuest);
    const before = await fingerprint(source);
    await source.$executeRawUnsafe(`CREATE ROLE ${backupRole} LOGIN PASSWORD '${backupPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await source.$executeRawUnsafe(`GRANT CONNECT ON DATABASE vantara_showroom TO ${backupRole}`);
    await source.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${backupRole}`);
    await source.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${backupRole}`);
    const backupUrl = new URL(url); backupUrl.username = backupRole; backupUrl.password = backupPassword;
    const backup = new PrismaClient({ datasources: { db: { url: backupUrl.toString() } }, log: [] });
    try {
      const [privilege] = await backup.$queryRawUnsafe("SELECT NOT has_table_privilege('sessions','INSERT') AND NOT has_schema_privilege('public','CREATE') AND NOT pg_has_role('vantara_showroom_runtime','MEMBER') AS safe");
      check(privilege?.safe === true, 'RECOVERY_BACKUP_AUTHORITY');
    } finally { await backup.$disconnect(); }
    console.log('REC01_BACKUP_IDENTITY PASS');
    dump = docker(container, ['pg_dump', '-h', '127.0.0.1', '-U', backupRole, '-d', 'vantara_showroom', '--format=custom', '--no-owner', '--no-acl'], backupPassword);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    encrypted = Buffer.concat([cipher.update(dump), cipher.final()]); const tag = cipher.getAuthTag(); dump.fill(0);
    console.log('REC02_ENCRYPTED_SYNTHETIC_EXPORT PASS');
    const existing = await source.$queryRawUnsafe(`SELECT datname FROM pg_database WHERE datname='${target}'`);
    check(existing.length === 0, 'RECOVERY_TARGET_EXISTS');
    await source.$executeRawUnsafe(`CREATE ROLE ${recoveryRole} LOGIN PASSWORD '${recoveryPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await source.$executeRawUnsafe(`CREATE DATABASE ${target} OWNER ${recoveryRole}`);
    await source.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${target} FROM PUBLIC`);
    await source.$executeRawUnsafe(`COMMENT ON DATABASE ${target} IS 'VANTARA_SHOWROOM_RECOVERY_SYNTHETIC_ONLY'`);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAuthTag(tag);
    dump = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    docker(container, ['pg_restore', '-h', '127.0.0.1', '-U', recoveryRole, '-d', target, '--no-owner', '--no-acl', '--exit-on-error'], recoveryPassword, dump);
    dump.fill(0);
    const restoredUrl = new URL(url); restoredUrl.pathname = '/' + target; restoredUrl.username = recoveryRole; restoredUrl.password = recoveryPassword;
    restored = new PrismaClient({ datasources: { db: { url: restoredUrl.toString() } }, log: [] });
    check(await fingerprint(restored) === before, 'RECOVERY_DATA_MISMATCH');
    console.log('REC03_NEW_TARGET_INTEGRITY PASS');
    await denied(() => verifyShowroomDatabase(restored), 'RECOVERY_INGRESS_NOT_FENCED');
    console.log('REC04_INGRESS_FENCED PASS');
    // Only the NEW recovery target is changed. Invalidate ALL recovered authorities.
    await restored.$transaction(async tx => {
      await tx.session.deleteMany();
      await tx.guestConnectBootstrap.updateMany({ data: { revokedAt: new Date() } });
      await tx.guestConnectSession.updateMany({ data: { revokedAt: new Date() } });
      for (const row of await tx.guestConnectAccess.findMany({ select: { id: true } })) {
        await tx.guestConnectAccess.update({ where: { id: row.id }, data: { generation: { increment: 1 }, tokenHash: 'showroom-proof:' + fresh() } });
      }
    });
    const recovery = new PostgresGuestAccessRepository(restored, SHOWROOM_GUEST_POLICY, 'showroom-proof');
    await denied(() => recovery.checkSession(oldGuest), 'RECOVERY_GUEST_RESURRECTED');
    await denied(() => recovery.exchangeOnce({ codeHash: codes[1], freshSessionHash: fresh() }), 'RECOVERY_INVITATION_RESURRECTED');
    await denied(() => recovery.manageShowroomAdmission(operator, reservations[0], { codeHash: fresh(), rootHash: fresh() }), 'RECOVERY_STAFF_RESURRECTED');
    console.log('REC05_RESTORED_AUTHORITY_REVOKED PASS');
    const newStaff = fresh();
    await restored.session.create({ data: { userId: member.userId, activeTenantId: member.tenantId, tokenHash: newStaff, expiresAt: new Date(Date.now() + 3600000) } });
    const newCode = fresh(), newGuest = fresh();
    await recovery.manageShowroomAdmission({ ...operator, sessionHash: newStaff }, reservations[0], { codeHash: newCode, rootHash: fresh() });
    await recovery.exchangeOnce({ codeHash: newCode, freshSessionHash: newGuest });
    await recovery.checkSession(newGuest);
    await denied(() => recovery.exchangeOnce({ codeHash: newCode, freshSessionHash: fresh() }), 'RECOVERY_REPLAY');
    await recovery.revokeSession(newGuest);
    await denied(() => recovery.checkSession(newGuest), 'RECOVERY_REVOKE');
    console.log('REC06_REISSUE_REPLAY_REVOKE PASS');
    check(await fingerprint(source) === before, 'RECOVERY_SOURCE_CHANGED');
    console.log('REC07_SOURCE_UNCHANGED PASS');
    check(Date.now() - started <= 900000, 'RECOVERY_TIME_LIMIT');
    console.log('REC08_TIMING PASS elapsed_ms=' + (Date.now() - started) + ' synthetic_fenced_rpo_ms=0');
  } finally {
    key.fill(0); dump?.fill(0); encrypted?.fill(0);
    await restored?.$disconnect(); await source.$disconnect();
  }
}
module.exports = { rehearse };
