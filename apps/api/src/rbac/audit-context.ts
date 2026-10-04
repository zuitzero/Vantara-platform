import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

// Populated only by the authenticated server request, never by request bodies.
export const auditActor = new AsyncLocalStorage<{ tenantId: string; userId: string }>();
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    if (!request.auth) return next.handle();
    return new Observable(subscriber => auditActor.run({ tenantId: request.auth.tenant.id, userId: request.auth.user.id }, () => next.handle().subscribe(subscriber)));
  }
}
