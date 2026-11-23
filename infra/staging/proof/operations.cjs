const cases = Object.freeze(['PROVIDER01_FIRST_HTTP', 'PROVIDER02_PRIVATE_PRISMA_TLS', 'PROVIDER03_PRIVATE_ORIGINS_DB',
  'PROVIDER04_TLS_WSS_RECONNECT', 'PROVIDER05_SINGLE_REPLICA', 'PROVIDER06_OPERATOR_MFA',
  'PROVIDER07_CSRF_REPLAY_LIMITS', 'PROVIDER08_RESTORE_REISSUE', 'PROVIDER09_ALERT_ROLLBACK',
  'PROVIDER10_RETENTION_SUPPORT', 'DEVICE01_LAPTOP_PHONE', 'DEVICE02_WIFI_CELLULAR']);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function acceptance(report, expectedSha) {
  if (!sha(expectedSha) || report?.sha !== expectedSha || report?.scope !== 'approved-provider-synthetic' ||
      !sha(report?.configSha) || !sha(report?.authorizationSha) || !Array.isArray(report.rows) || report.rows.length !== cases.length) return false;
  return cases.every(id => {
    const rows = report.rows.filter(row => row.id === id);
    return rows.length === 1 && rows[0].status === 'PASS' && sha(rows[0].evidenceSha);
  });
}
function singleton(snapshot) {
  return snapshot?.desired === 1 && snapshot.running === 1 && snapshot.pending === 0 && snapshot.min === 1 &&
    snapshot.max === 1 && snapshot.maxSurge === 0 && snapshot.autoscale === false && snapshot.writerLease === true;
}
function alerts({ spend, budget, ageDays, backupAgeMinutes, probeFailures, errorPercent, errorMinutes, certDays, replicas }) {
  if (![spend, budget, ageDays, backupAgeMinutes, probeFailures, errorPercent, errorMinutes, certDays, replicas]
    .every(Number.isFinite) || budget <= 0 || spend < 0 || ageDays < 0 || backupAgeMinutes < 0 ||
      probeFailures < 0 || errorPercent < 0 || errorMinutes < 0) throw new Error('METRICS_REJECTED');
  const result = [];
  for (const percent of [50, 75, 90]) if (spend / budget >= percent / 100) result.push('SPEND_' + percent);
  if (spend >= budget || ageDays >= 30) result.push('ADMISSION_STOP_REVIEW');
  if (backupAgeMinutes > 15) result.push('BACKUP_STALE');
  if (probeFailures >= 2 || (errorPercent > 2 && errorMinutes >= 5)) result.push('PAGE_OPERATOR');
  if (certDays <= 14) result.push('CERT_RENEWAL');
  if (replicas !== 1) result.push('FENCE_WRITES');
  return result;
}
class RecoveryGate {
  #phase = 'FENCED';
  verify(event) {
    const transitions = { FENCED: 'SOCKETS_DRAINED', SOCKETS_DRAINED: 'NEW_TARGET_VERIFIED',
      NEW_TARGET_VERIFIED: 'AUTHORITY_REVOKED', AUTHORITY_REVOKED: 'PAIRED_ARTIFACTS_VERIFIED',
      PAIRED_ARTIFACTS_VERIFIED: 'REISSUE_ISOLATION_VERIFIED', REISSUE_ISOLATION_VERIFIED: 'ALERT_ACKNOWLEDGED' };
    if (transitions[this.#phase] !== event) throw new Error('RECOVERY_ORDER_REJECTED');
    this.#phase = event;
  }
  get readyForIndependentReview() { return this.#phase === 'ALERT_ACKNOWLEDGED'; }
  // There is deliberately no method that opens ingress or deploys artifacts.
}
function pending(shaValue) {
  if (!sha(shaValue)) throw new Error('REVISION_REJECTED');
  return { sha: shaValue, scope: 'disposable-only', deploymentAuthorized: false,
    rows: cases.map(id => ({ id, status: id.startsWith('DEVICE') ? 'NOT RUN' : 'BLOCKED' })) };
}
module.exports = { cases, acceptance, singleton, alerts, RecoveryGate, pending };
