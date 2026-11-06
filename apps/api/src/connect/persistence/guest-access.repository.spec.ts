import { GUEST_PROTOCOL, GuestProtocolDenied } from '../protocol/guest-access.contracts';
import { PostgresGuestAccessRepository } from './guest-access.repository';
const { configuration, ROLE } = require('../../../scripts/connect-sec02-target.cjs');

describe('Inactive repository fail-closed boundaries', () => {
  const valid = { NODE_ENV: 'test', CONNECT_SEC02_DB_TEST: '1', CONNECT_SEC02_DATABASE_URL: `postgresql://${ROLE}:synthetic@127.0.0.1/vantara_connect_sec02?schema=public` };
  it('accepts only the exact isolated test connection contract', () => { expect(configuration(valid).hostname).toBe('127.0.0.1'); });
  it.each([{ NODE_ENV: 'production' }, { CONNECT_SEC02_DB_TEST: '0' }, { CONNECT_SEC02_DATABASE_URL: 'postgresql://synthetic@remote.invalid/prod' }, { CONNECT_SEC02_DATABASE_URL: valid.CONNECT_SEC02_DATABASE_URL.replace('127.0.0.1', 'localhost') }, { CONNECT_SEC02_DATABASE_URL: valid.CONNECT_SEC02_DATABASE_URL.replace('vantara_connect_sec02?', 'vantara_pilot01?') }, { CONNECT_SEC02_DATABASE_URL: valid.CONNECT_SEC02_DATABASE_URL + '&options=unsafe' }])('rejects non-disposable targets without echoing input', change => {
    expect(() => configuration({ ...valid, ...change })).toThrow('CONNECT_SEC02_TARGET_REJECTED');
  });
  it('does not default or accept unbounded policy', () => {
    expect(() => new PostgresGuestAccessRepository({} as any, undefined as any)).toThrow(GuestProtocolDenied);
    expect(() => new PostgresGuestAccessRepository({} as any, { ...GUEST_PROTOCOL, maxSessions: 4 })).toThrow(GuestProtocolDenied);
  });
  it('rejects raw/malformed secret inputs before database use', async () => {
    const db = { $transaction: jest.fn() };
    const repo = new PostgresGuestAccessRepository(db as any, GUEST_PROTOCOL);
    await expect(repo.exchangeOnce({ codeHash: 'not-a-hash', freshSessionHash: 'not-a-hash' })).rejects.toThrow(GuestProtocolDenied);
    await expect(repo.checkSession('not-a-hash')).rejects.toThrow(GuestProtocolDenied);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('bounds serialization/deadlock retries and sanitizes database errors', async () => {
    const db = { $transaction: jest.fn().mockRejectedValue({ code: 'P2034', message: 'PRIVATE_ERROR_CANARY' }) };
    const repo = new PostgresGuestAccessRepository(db as any, GUEST_PROTOCOL);
    await expect(repo.advanceGeneration('hotel-a', 'stay-a')).rejects.toThrow('GUEST_ACCESS_DENIED');
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    db.$transaction.mockReset().mockRejectedValue({ code: 'P2002', message: 'PRIVATE_ERROR_CANARY' });
    await expect(repo.advanceGeneration('hotel-a', 'stay-a')).rejects.toThrow('GUEST_ACCESS_DENIED');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
