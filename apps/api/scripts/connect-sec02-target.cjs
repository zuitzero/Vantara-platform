// Strictly disposable synthetic test target; never a staging/production connection helper.
const ROLE = 'vantara_connect_sec02_test';
const MARKER = 'CONNECT_SEC02_DISPOSABLE_SYNTHETIC_ONLY';
function configuration(env) {
  const fail = () => { throw new Error('CONNECT_SEC02_TARGET_REJECTED'); };
  if (env.NODE_ENV !== 'test' || env.CONNECT_SEC02_DB_TEST !== '1') fail();
  let url; try { url = new URL(env.CONNECT_SEC02_DATABASE_URL); } catch { fail(); }
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.pathname !== '/vantara_connect_sec02' ||
      url.username !== ROLE || !url.password || url.hash || [...url.searchParams].some(([k, v]) => k !== 'schema' || v !== 'public')) fail();
  return url;
}
async function verify(db) {
  const [r] = await db.$queryRaw`SELECT current_database() AS database, current_user AS role,
    current_setting('server_version_num')::int AS version,
    shobj_description(d.oid, 'pg_database') AS marker,
    session_user = current_user AS direct,
    r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS elevated,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS membership,
    has_database_privilege(current_user, current_database(), 'CREATE') OR has_database_privilege(current_user, current_database(), 'TEMP') OR has_schema_privilege(current_user, 'public', 'CREATE') AS ddl,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=r.oid) AS owns
    FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`;
  if (!r || r.database !== 'vantara_connect_sec02' || r.role !== ROLE || r.marker !== MARKER || r.version < 180000 || r.version >= 190000 || !r.direct || r.elevated || r.membership || r.ddl || r.owns) throw new Error('CONNECT_SEC02_TARGET_REJECTED');
}
module.exports = { ROLE, MARKER, configuration, verify };
