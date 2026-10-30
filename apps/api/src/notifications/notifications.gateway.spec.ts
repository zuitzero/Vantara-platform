import { NotificationsGateway } from './notifications.gateway';

function socketMock(cookie: string) {
  return {
    handshake: { headers: { cookie, origin: 'http://localhost:3000' } },
    data: {},
    join: jest.fn(),
    disconnect: jest.fn(),
  } as any;
}

describe('NotificationsGateway', () => {
  it('joins the tenant recipient room and hotel audience room for staff', async () => {
    const authService = {
      getWorkspace: jest.fn().mockResolvedValue({
        user: { id: 'user-1' },
        tenant: { id: 'tenant-a' },
        membership: { role: 'HOTEL_STAFF' },
      }),
    } as any;
    const gateway = new NotificationsGateway(authService, { getTenantAccess: jest.fn().mockResolvedValue({ tenantType: 'HOTEL' }), assertTenantAccess: jest.fn() } as any);
    const socket = socketMock('vantara_session=session-token');

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('tenant:tenant-a:recipient:user-1');
    expect(socket.join).toHaveBeenCalledWith('tenant:tenant-a:audience:HOTEL');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('does not join the hotel audience room for a non-staff role', async () => {
    const authService = {
      getWorkspace: jest.fn().mockResolvedValue({
        user: { id: 'guest-1' },
        tenant: { id: 'tenant-a' },
        membership: { role: 'GUEST' },
      }),
    } as any;
    const gateway = new NotificationsGateway(authService, { getTenantAccess: jest.fn().mockResolvedValue({ tenantType: 'HOTEL' }), assertTenantAccess: jest.fn() } as any);
    const socket = socketMock('vantara_session=session-token');

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('tenant:tenant-a:recipient:guest-1');
    expect(socket.join).not.toHaveBeenCalledWith('tenant:tenant-a:audience:HOTEL');
  });

  it('disconnects clients without a valid session cookie', async () => {
    const authService = { getWorkspace: jest.fn() } as any;
    const gateway = new NotificationsGateway(authService, { getTenantAccess: jest.fn().mockResolvedValue({ tenantType: 'HOTEL' }), assertTenantAccess: jest.fn() } as any);
    const socket = socketMock('other_cookie=value');

    await gateway.handleConnection(socket);

    expect(authService.getWorkspace).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});


describe('Realtime origin and delivery isolation', () => {
  const workspace = { user: { id: 'staff-a' }, tenant: { id: 'hotel-a' }, membership: { role: 'HOTEL_ADMIN' } };
  const event = { tenantId: 'hotel-a', audience: 'HOTEL', severity: 'INFO', title: 'Synthetic', message: 'Synthetic', type: 'TEST' } as const;
  function fixture() {
    const auth = { getWorkspace: jest.fn().mockResolvedValue(workspace) };
    const rbac = { getTenantAccess: jest.fn().mockResolvedValue({ tenantType: 'HOTEL' }), assertTenantAccess: jest.fn<Promise<void>, any[]>().mockResolvedValue(undefined) };
    const gateway = new NotificationsGateway(auth as any, rbac as any);
    const socket = socketMock('vantara_session=synthetic'); socket.emit = jest.fn();
    gateway.server = { in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([socket]) }) } as any;
    return { auth, rbac, gateway, socket };
  }
  it.each([undefined, 'null', 'https://evil.example.invalid', 'http://localhost:3000.evil.invalid'])('rejects WebSocket origin %s before session lookup or joining rooms', async origin => {
    const { gateway, socket, auth } = fixture(); socket.handshake.headers.origin = origin;
    await gateway.handleConnection(socket);
    expect(socket.disconnect).toHaveBeenCalledWith(true); expect(socket.join).not.toHaveBeenCalled(); expect(auth.getWorkspace).not.toHaveBeenCalled();
  });
  it('revalidates a legitimate recipient before delivering a persisted notification', async () => {
    const { gateway, socket, auth } = fixture(); await gateway.handleConnection(socket); await gateway.emit(event);
    expect(auth.getWorkspace).toHaveBeenCalledTimes(2); expect(socket.emit).toHaveBeenCalledWith('notification', event);
    expect(gateway.server.in).toHaveBeenCalledWith('tenant:hotel-a:audience:HOTEL');
  });
  it.each(['logout', 'membership', 'permission', 'tenant-switch', 'role-change'])('withholds events after %s and disconnects the stale socket', async reason => {
    const { gateway, socket, auth, rbac } = fixture(); await gateway.handleConnection(socket);
    if (reason === 'logout') auth.getWorkspace.mockRejectedValue(new Error('expired or revoked'));
    if (reason === 'membership') rbac.getTenantAccess.mockResolvedValue(null as any);
    if (reason === 'permission') rbac.assertTenantAccess.mockRejectedValue(new Error('denied'));
    if (reason === 'tenant-switch') auth.getWorkspace.mockResolvedValue({ ...workspace, tenant: { id: 'hotel-b' } });
    if (reason === 'role-change') auth.getWorkspace.mockResolvedValue({ ...workspace, membership: { role: 'GUEST' } });
    await gateway.emit(event);
    expect(socket.emit).not.toHaveBeenCalled(); expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
  it('does not deliver another tenant event even if a socket is incorrectly returned by the adapter', async () => {
    const { gateway, socket } = fixture(); await gateway.handleConnection(socket);
    await gateway.emit({ ...event, tenantId: 'hotel-b' });
    expect(socket.emit).not.toHaveBeenCalled(); expect(socket.disconnect).toHaveBeenCalled();
  });
});
