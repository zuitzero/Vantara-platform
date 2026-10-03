import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Permissions('notifications.read')
  list(@Req() req: any) {
    return this.notifications.listForHotel(
      req.tenantContext.tenantId,
      req.auth.user.id,
      req.auth.membership.role,
    );
  }

  @Get('unread')
  @Permissions('notifications.read')
  listUnread(@Req() req: any) {
    return this.notifications.listForHotel(
      req.tenantContext.tenantId,
      req.auth.user.id,
      req.auth.membership.role,
      true,
    );
  }

  @Patch(':notificationId/read')
  @Permissions('notifications.manage')
  markRead(@Req() req: any, @Param('notificationId') notificationId: string) {
    return this.notifications.markRead(
      req.tenantContext.tenantId,
      notificationId,
      req.auth.user.id,
      req.auth.membership.role,
    );
  }
}
