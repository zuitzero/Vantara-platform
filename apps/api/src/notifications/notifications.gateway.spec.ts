import { NotificationsGateway } from './notifications.gateway';

function socketMock(cookie: string) {
  return {
    handshake: { headers: { cookie } },
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
        membership: { role: 'STAFF' },
      }),
    } as any;
    const gateway = new NotificationsGateway(authService);
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
    const gateway = new NotificationsGateway(authService);
    const socket = socketMock('vantara_session=session-token');

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('tenant:tenant-a:recipient:guest-1');
    expect(socket.join).not.toHaveBeenCalledWith('tenant:tenant-a:audience:HOTEL');
  });

  it('disconnects clients without a valid session cookie', async () => {
    const authService = { getWorkspace: jest.fn() } as any;
    const gateway = new NotificationsGateway(authService);
    const socket = socketMock('other_cookie=value');

    await gateway.handleConnection(socket);

    expect(authService.getWorkspace).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
