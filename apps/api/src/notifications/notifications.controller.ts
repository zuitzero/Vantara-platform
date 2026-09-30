import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard, TenantContextGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: any) {
    return this.notifications.listForHotel(req.tenantContext.tenantId, req.auth.user.id);
  }

  @Patch(':notificationId/read')
  markRead(@Req() req: any, @Param('notificationId') notificationId: string) {
    return this.notifications.markRead(req.tenantContext.tenantId, notificationId, req.auth.user.id);
  }
}
