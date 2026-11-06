import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { GuestRequestCategory, GuestRequestPriority } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestsService } from '../../requests/requests.service';
import { GUEST_PROTOCOL, GuestProtocolDenied } from '../protocol/guest-access.contracts';
import { GuestPayloadConflict, PostgresGuestAccessRepository } from '../persistence/guest-access.repository';
import { digest } from './guest-http.security';

export function requestInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GuestProtocolDenied();
  const row = body as Record<string, unknown>;
  if (Object.keys(row).some(key => !['title', 'message', 'category', 'priority', 'guestCount'].includes(key))) throw new GuestProtocolDenied();
  const { title, message, category } = row; const priority = row.priority ?? 'NORMAL', guestCount = row.guestCount ?? 1;
  if (typeof title !== 'string' || title.trim().length < 2 || title.length > 120 || typeof message !== 'string' || message.trim().length < 2 || message.length > 1000 ||
      !Object.values(GuestRequestCategory).includes(category as any) || !Object.values(GuestRequestPriority).includes(priority as any) || !Number.isSafeInteger(guestCount) || (guestCount as number) < 1 || (guestCount as number) > 100) throw new GuestProtocolDenied();
  return { title: title.trim(), message: message.trim(), category: category as GuestRequestCategory, priority: priority as GuestRequestPriority, guestCount: guestCount as number };
}
const projection = { id: true, title: true, message: true, category: true, priority: true, status: true, createdAt: true, completedAt: true } as const;
@Injectable()
export class GuestHttpService {
  readonly repository: PostgresGuestAccessRepository;
  constructor(db: PrismaService, private readonly requests: RequestsService) { this.repository = new PostgresGuestAccessRepository(db, GUEST_PROTOCOL); }
  async issue(tenantId: string, reservationId: string) {
    const code = randomBytes(32).toString('base64url');
    const record = await this.repository.createBootstrap({ tenantId, reservationId, codeHash: digest(code), rootHash: digest(randomBytes(32).toString('base64url')) });
    return { code, expiresAt: record.expiresAt }; // Single authorized delivery, no URL or logs.
  }
  async exchange(code: string) {
    const secret = randomBytes(32).toString('base64url');
    const record = await this.repository.exchangeOnce({ codeHash: digest(code), freshSessionHash: digest(secret) });
    return { secret, expiresAt: record.expiresAt };
  }
  stay(secret: string) {
    return this.repository.withSession(digest(secret), async (tx, scope, guestId) => {
      const reservation = await tx.reservation.findFirstOrThrow({ where: { id: scope.reservationId, tenantId: scope.tenantId }, select: {
        confirmationCode: true, status: true, checkIn: true, checkOut: true, guest: { select: { firstName: true, lastName: true } }, property: { select: { name: true } }, room: { select: { number: true } }, roomType: { select: { name: true } },
      } });
      const requests = await tx.guestRequest.findMany({ where: { tenantId: scope.tenantId, reservationId: scope.reservationId, guestId }, select: projection, orderBy: { createdAt: 'desc' }, take: 50 });
      return { reservation, requests };
    });
  }
  async create(secret: string, key: string, body: unknown) {
    const input = requestInput(body); const keyHash = digest(key), payloadHash = digest(JSON.stringify(input));
    const result = await this.repository.withSession(digest(secret), async (tx, scope, guestId) => {
      const where = { accessId: scope.accessId, generation: scope.generation, keyHash };
      const claim = await tx.guestConnectIdempotency.findUnique({ where: { accessId_generation_keyHash: where } });
      if (claim) {
        if (claim.payloadHash !== payloadHash) throw new GuestPayloadConflict();
        const request = await tx.guestRequest.findFirst({ where: { id: claim.resultRequestId ?? '', tenantId: scope.tenantId, reservationId: scope.reservationId, guestId }, select: projection });
        if (!request) throw new GuestProtocolDenied();
        return { response: request, notification: null };
      }
      const request = await this.requests.createReservationRequestInTransaction(tx, scope.tenantId, scope.reservationId, input);
      await tx.guestConnectIdempotency.create({ data: { ...where, tenantId: scope.tenantId, reservationId: scope.reservationId, payloadHash, resultRequestId: request.id } });
      const response = await tx.guestRequest.findUniqueOrThrow({ where: { id: request.id }, select: projection });
      return { response, notification: request };
    });
    // Commit precedes best-effort delivery; retries of the durable result do not repeat delivery.
    if (result.notification) await this.requests.publishReservationRequest(result.notification).catch(() => undefined);
    return result.response;
  }
  logout(secret: string) { return this.repository.revokeSession(digest(secret)); }
}
