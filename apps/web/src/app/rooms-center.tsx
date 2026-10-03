'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import './rooms-center.css';

type RoomStatus = 'AVAILABLE' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

type Room = {
  id: string;
  number: string;
  status: RoomStatus;
  property: { id: string; name: string };
  roomType: { id: string; name: string; code: string };
  guests?: Array<{ id: string; firstName: string; lastName: string }>;
  reservations?: Array<{ id: string; status: string; guest?: { firstName: string; lastName: string } }>;
};

const statuses: Array<'ALL' | RoomStatus> = ['ALL', 'AVAILABLE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE', 'OUT_OF_SERVICE'];

export function RoomsCenter({ base, canManage }: { base: string; canManage: boolean }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<(typeof statuses)[number]>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${base}/rooms`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Unable to load rooms (${response.status}).`);
      const data = await response.json();
      setRooms(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load rooms.');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => filter === 'ALL' ? rooms : rooms.filter((room) => room.status === filter), [filter, rooms]);
  const counts = useMemo(() => Object.fromEntries(statuses.slice(1).map((status) => [status, rooms.filter((room) => room.status === status).length])), [rooms]);

  const updateStatus = async (room: Room, status: RoomStatus) => {
    if (!canManage || room.status === status) return;
    setUpdating(room.id);
    try {
      const response = await fetch(`${base}/rooms/${room.id}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error('Room status update failed.');
      const updated = await response.json();
      setRooms((current) => current.map((item) => item.id === room.id ? { ...item, ...updated } : item));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Room status update failed.');
    } finally {
      setUpdating(null);
    }
  };

  return <section className="rooms-center">
    <div className="rooms-hero">
      <div><span className="panel-kicker">ROOM OPERATIONS / INVENTORY</span><h2>Rooms</h2><p>Live room inventory, operational state and occupancy context for the active hotel tenant.</p></div>
      <button className="refresh-button" onClick={() => void load()} disabled={loading}>↻ {loading ? 'Syncing' : 'Sync'}</button>
    </div>

    <div className="room-stats">
      {(['AVAILABLE','OCCUPIED','CLEANING','MAINTENANCE','OUT_OF_SERVICE'] as RoomStatus[]).map((status) => <div className={`room-stat ${status.toLowerCase()}`} key={status}><span>{status.replaceAll('_',' ')}</span><strong>{counts[status] ?? 0}</strong></div>)}
    </div>

    <div className="room-toolbar">
      <div className="room-filters">{statuses.map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{status.replaceAll('_',' ')}</button>)}</div>
      <span>{visible.length} {visible.length === 1 ? 'room' : 'rooms'}</span>
    </div>

    {error && <div className="request-error">⚠ {error}</div>}
    {loading ? <div className="room-empty"><strong>Loading room inventory</strong><span>Resolving tenant-scoped room state...</span></div> : visible.length === 0 ? <div className="room-empty"><strong>No rooms in this view</strong><span>Try another operational status filter.</span></div> : <div className="room-grid">{visible.map((room) => {
      const guest = room.guests?.[0] ?? room.reservations?.[0]?.guest;
      return <article className={`room-card ${room.status.toLowerCase()}`} key={room.id}>
        <div className="room-card-head"><div><span className="room-number">{room.number}</span><span className="room-type">{room.roomType.name}</span></div><span className="room-status"><i />{room.status.replaceAll('_',' ')}</span></div>
        <div className="room-card-body"><span>PROPERTY <b>{room.property.name}</b></span><span>GUEST <b>{guest ? `${guest.firstName} ${guest.lastName}` : 'None'}</b></span></div>
        {canManage ? <div className="room-actions"><select value={room.status} disabled={updating === room.id} onChange={(event) => void updateStatus(room, event.target.value as RoomStatus)}>{statuses.slice(1).map((status) => <option key={status} value={status}>{status.replaceAll('_',' ')}</option>)}</select></div> : <div className="room-readonly">READ ONLY</div>}
      </article>;
    })}</div>}
  </section>;
}
