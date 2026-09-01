import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminDashboardService } from './admin-dashboard.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Body, Param, Post } from '@nestjs/common'; // add to existing imports
import { PaymentsService } from '../payments/payments.service';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtGuard, RolesGuard)
@Roles('ADMIN', 'SUPERVISOR')
@Controller('admin')
export class AdminDashboardController {
  constructor(
    private dashboard: AdminDashboardService,
    private payments: PaymentsService,
  ) {}

  @Roles('ADMIN') // method-level: refunds are admin-only
  @Post('orders/:id/refund')
  refundOrder(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.payments.refundOrder(id, user.id, reason);
  }

  @Get('dashboard')
  getDashboard() {
    return this.dashboard.getDashboard();
  }

  @Get('orders')
  listOrders(
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.dashboard.listOrders({
      status,
      paymentStatus,
      search,
      from,
      to,
      page,
      pageSize,
    });
  }

  @Get('customers')
  listCustomers(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.dashboard.listCustomers({ search, page, pageSize });
  }

  @Roles('ADMIN')
  @Post('orders/expire-stale')
  expireStale(@Query('minutes') minutes?: string) {
    const mins = minutes ? Number(minutes) : 60;
    return this.payments.expireStalePendingOrders(
      Number.isFinite(mins) && mins > 0 ? mins : 60,
    );
  }
}
