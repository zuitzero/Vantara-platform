const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acceptance, singleton, alerts, RecoveryGate, pending, cases } = require('./operations.cjs');
test('GATE01 local/CI evidence cannot satisfy actual-provider acceptance', () => {
  const revision = 'a'.repeat(40), report = pending(revision);
  assert.equal(acceptance(report, revision), false);
  assert.equal(report.rows.length, 12); assert.equal(report.deploymentAuthorized, false);
  for (const row of report.rows) row.status = 'PASS';
  assert.equal(acceptance(report, revision), false);
});
test('GATE02 complete exact-revision evidence required; duplicates, drift and missing rows deny', () => {
  const revision = 'b'.repeat(40);
  const report = { sha: revision, scope: 'approved-provider-synthetic', configSha: revision, authorizationSha: revision,
    rows: cases.map(id => ({ id, status: 'PASS', evidenceSha: revision })) };
  assert.equal(acceptance(report, revision), true);
  assert.equal(acceptance(report, 'a'.repeat(40)), false);
  for (const status of ['FAIL', 'BLOCKED', 'NOT RUN', 'UNKNOWN']) {
    assert.equal(acceptance({ ...report, rows: report.rows.map((row, i) => i ? row : { ...row, status }) }, revision), false);
  }
  assert.equal(acceptance({ ...report, rows: [...report.rows.slice(1), report.rows[1]] }, revision), false);
  assert.equal(acceptance({ ...report, rows: report.rows.slice(1) }, revision), false);
});
test('GATE03 declared replica count alone is insufficient; rolling surge and extra writers deny', () => {
  const snapshot = { desired: 1, running: 1, pending: 0, min: 1, max: 1, maxSurge: 0, autoscale: false, writerLease: true };
  assert.equal(singleton(snapshot), true); assert.equal(singleton({ desired: 1 }), false);
  for (const change of [{ max: 2 }, { running: 2 }, { pending: 1 }, { maxSurge: 1 }, { autoscale: true }, { writerLease: false }]) assert.equal(singleton({ ...snapshot, ...change }), false);
});
test('OPS01 budget thresholds, day-30 stop, expiry and synthetic fault alerts are measurable', () => {
  const healthy = { spend: 0, budget: 100, ageDays: 1, backupAgeMinutes: 1, probeFailures: 0, errorPercent: 0, errorMinutes: 0, certDays: 30, replicas: 1 };
  assert.deepEqual(alerts(healthy), []);
  assert.deepEqual(alerts({ ...healthy, spend: 90 }), ['SPEND_50', 'SPEND_75', 'SPEND_90']);
  assert.deepEqual(alerts({ ...healthy, ageDays: 30, backupAgeMinutes: 16, probeFailures: 2, certDays: 14, replicas: 2 }),
    ['ADMISSION_STOP_REVIEW', 'BACKUP_STALE', 'PAGE_OPERATOR', 'CERT_RENEWAL', 'FENCE_WRITES']);
  assert.throws(() => alerts({ ...healthy, budget: 0 }), /REJECTED/);
});
test('OPS02 rollback/restore cannot skip fencing, revocation, paired artifacts or alert acknowledgement', () => {
  const gate = new RecoveryGate(); assert.equal(gate.readyForIndependentReview, false);
  assert.throws(() => gate.verify('PAIRED_ARTIFACTS_VERIFIED'), /REJECTED/);
  for (const event of ['SOCKETS_DRAINED', 'NEW_TARGET_VERIFIED', 'AUTHORITY_REVOKED', 'PAIRED_ARTIFACTS_VERIFIED', 'REISSUE_ISOLATION_VERIFIED', 'ALERT_ACKNOWLEDGED']) gate.verify(event);
  assert.equal(gate.readyForIndependentReview, true); assert.equal(gate.deploy, undefined);
});
