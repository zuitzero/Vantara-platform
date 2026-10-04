'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import './rooms-center.css';

type RoomOccupancyStatus = 'VACANT' | 'OCCUPIED';
type RoomReadinessStatus = 'READY' | 'CLEANING' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
type RoomFilter = 'ALL' | RoomOccupancyStatus | RoomReadinessStatus;

type Room = {
  id: string;
  number: string;
  occupancyStatus: RoomOccupancyStatus;
  readinessStatus: RoomReadinessStatus;
  outOfServiceLocked: boolean;
  property: { id: string; name: string };
  roomType: { id: string; name: string; code: string };
  guests?: Array<{ id: string; firstName: string; lastName: string }>;
  reservations?: Array<{ id: string; status: string; guest?: { firstName: string; lastName: string } }>;
};

const filters: RoomFilter[] = ['ALL', 'VACANT', 'OCCUPIED', 'READY', 'CLEANING', 'MAINTENANCE', 'OUT_OF_SERVICE'];
const occupancyOptions: RoomOccupancyStatus[] = ['VACANT', 'OCCUPIED'];
const readinessOptions: RoomReadinessStatus[] = ['READY', 'OUT_OF_SERVICE'];

export function RoomsCenter({ base, canManage }: { base: string; canManage: boolean }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<RoomFilter>('ALL');
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

  const visible = useMemo(() => {
    if (filter === 'ALL') return rooms;
    return rooms.filter((room) => room.occupancyStatus === filter || room.readinessStatus === filter);
  }, [filter, rooms]);

  const counts = useMemo(() => ({
    VACANT: rooms.filter((room) => room.occupancyStatus === 'VACANT').length,
    OCCUPIED: rooms.filter((room) => room.occupancyStatus === 'OCCUPIED').length,
    READY: rooms.filter((room) => room.readinessStatus === 'READY').length,
    CLEANING: rooms.filter((room) => room.readinessStatus === 'CLEANING').length,
    MAINTENANCE: rooms.filter((room) => room.readinessStatus === 'MAINTENANCE').length,
    OUT_OF_SERVICE: rooms.filter((room) => room.readinessStatus === 'OUT_OF_SERVICE').length,
  }), [rooms]);

  const patchRoom = async (room: Room, kind: 'occupancy' | 'readiness', value: RoomOccupancyStatus | RoomReadinessStatus) => {
    if (!canManage) return;
    setUpdating(room.id);
    try {
      const key = kind === 'occupancy' ? 'occupancyStatus' : 'readinessStatus';
      const response = await fetch(`${base}/rooms/${room.id}/${kind}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!response.ok) throw new Error(`Room ${kind} update failed.`);
      const updated = await response.json();
      setRooms((current) => current.map((item) => item.id === room.id ? { ...item, ...updated } : item));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Room update failed.');
    } finally {
      setUpdating(null);
    }
  };

  return <section className="rooms-center">
    <div className="rooms-hero">
      <div><span className="panel-kicker">ROOM OPERATIONS / INVENTORY</span><h2>Rooms</h2><p>Occupancy and operational readiness are tracked independently for every room.</p></div>
      <button className="refresh-button" onClick={() => void load()} disabled={loading}>↻ {loading ? 'Syncing' : 'Sync'}</button>
    </div>

    <div className="room-stats">
      {(['VACANT', 'OCCUPIED', 'READY', 'CLEANING', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const).map((status) => <div className={`room-stat ${status.toLowerCase()}`} key={status}><span>{status.replaceAll('_', ' ')}</span><strong>{counts[status]}</strong></div>)}
    </div>

    <div className="room-toolbar">
      <div className="room-filters">{filters.map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{status.replaceAll('_', ' ')}</button>)}</div>
      <span>{visible.length} {visible.length === 1 ? 'room' : 'rooms'}</span>
    </div>

    {error && <div className="request-error">⚠ {error}</div>}
    {loading ? <div className="room-empty"><strong>Loading room inventory</strong><span>Resolving tenant-scoped room state...</span></div> : visible.length === 0 ? <div className="room-empty"><strong>No rooms in this view</strong><span>Try another occupancy or readiness filter.</span></div> : <div className="room-grid">{visible.map((room) => {
      const guest = room.guests?.[0] ?? room.reservations?.[0]?.guest;
      return <article className={`room-card ${room.readinessStatus.toLowerCase()} ${room.occupancyStatus.toLowerCase()}`} key={room.id}>
        <div className="room-card-head"><div><span className="room-number">{room.number}</span><span className="room-type">{room.roomType.name}</span></div><div><span className="room-status"><i />{room.occupancyStatus}</span><span className="room-status">{room.readinessStatus.replaceAll('_', ' ')}</span></div></div>
        <div className="room-card-body"><span>PROPERTY <b>{room.property.name}</b></span><span>GUEST <b>{guest ? `${guest.firstName} ${guest.lastName}` : 'None'}</b></span></div>
        {canManage ? <div className="room-actions"><select value={room.occupancyStatus} disabled={updating === room.id} onChange={(event) => void patchRoom(room, 'occupancy', event.target.value as RoomOccupancyStatus)}>{occupancyOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label={`Administrative lock for room ${room.number}`} value={room.outOfServiceLocked ? 'OUT_OF_SERVICE' : 'READY'} disabled={updating === room.id} onChange={(event) => void patchRoom(room, 'readiness', event.target.value as RoomReadinessStatus)}>{readinessOptions.map((status) => <option key={status} value={status}>{status === 'READY' ? 'No administrative lock' : 'Lock: OUT OF SERVICE'}</option>)}</select></div> : <div className="room-readonly">READ ONLY</div>}
      </article>;
    })}</div>}
  </section>;
}

