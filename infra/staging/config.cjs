// Offline Phase A contract/renderer. Never connects, provisions, loads .env or emits secrets.
const fs = require('node:fs');
const path = require('node:path');
function reject() { throw new Error('STAGING_CONFIGURATION_REJECTED'); }
function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join() !== [...expected].sort().join()) reject();
}
function origin(value, privateOnly = false) {
  let url;
  try { url = new URL(value); } catch { reject(); }
  if (url.origin !== value || url.username || url.password) reject();
  if (privateOnly ? url.protocol !== 'http:' || !/^[a-z][a-z0-9-]*\.staging\.internal$/.test(url.hostname) :
    url.protocol !== 'https:' || !/^[a-z][a-z0-9.-]*\.example\.invalid$/.test(url.hostname)) reject();
  return url;
}
function validate(c) {
  keys(c, ['phase', 'dataMode', 'publicOrigin', 'webUpstream', 'apiUpstream', 'database', 'apiEnvironment', 'webEnvironment']);
  if (c.phase !== 'A' || c.dataMode !== 'synthetic-only') reject();
  origin(c.publicOrigin); origin(c.webUpstream, true); origin(c.apiUpstream, true);
  if (c.webUpstream === c.apiUpstream) reject();
  keys(c.database, ['host', 'name', 'runtimeRole', 'migrationRole', 'tls', 'connectionLimit']);
  const d = c.database;
  if (d.host !== 'db.staging.internal' || d.name !== 'vantara_staging' || d.runtimeRole !== 'vantara_staging_runtime' ||
      d.migrationRole !== 'vantara_staging_migrator' || d.tls !== 'verify-peer-and-host' || d.connectionLimit !== 5) reject();
  keys(c.apiEnvironment, ['NODE_ENV', 'VANTARA_ENV', 'ALLOW_LOCAL_WORKSPACE_SIGNUP', 'WEB_ORIGIN']);
  keys(c.webEnvironment, ['NODE_ENV', 'WEB_ORIGIN', 'API_INTERNAL_URL', 'NEXT_PUBLIC_API_URL']);
  const a = c.apiEnvironment, w = c.webEnvironment;
  if (a.NODE_ENV !== 'production' || a.VANTARA_ENV !== 'staging' || a.ALLOW_LOCAL_WORKSPACE_SIGNUP !== 'false' ||
      a.WEB_ORIGIN !== c.publicOrigin || w.NODE_ENV !== 'production' || w.WEB_ORIGIN !== c.publicOrigin ||
      w.API_INTERNAL_URL !== c.apiUpstream || w.NEXT_PUBLIC_API_URL !== '/api') reject();
  return c;
}
function render(c) {
  validate(c);
  const template = fs.readFileSync(path.join(__dirname, 'nginx.conf.template'), 'utf8');
  return template.replaceAll('@@HOST@@', new URL(c.publicOrigin).host)
    .replaceAll('@@WEB@@', c.webUpstream).replaceAll('@@API@@', c.apiUpstream);
}
module.exports = { validate, render };
if (require.main === module) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'staging.example.json'), 'utf8'));
    if (process.argv[2] === 'render') process.stdout.write(render(c));
    else if (process.argv[2] === 'check') { validate(c); console.log('Phase A offline contract valid; NOT deployment-ready.'); }
    else reject();
  } catch { console.error('STAGING_CONFIGURATION_REJECTED'); process.exitCode = 1; }
}
