import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AssignBookingDto } from './assignments.dto';

@UseGuards(JwtGuard, RolesGuard)
@Roles('ADMIN', 'SUPERVISOR')
@Controller('admin/bookings')
export class AssignmentsController {
  constructor(private assignments: AssignmentsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('assigned') assigned?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.assignments.listBookings({ status, assigned, employeeId });
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.assignments.getBooking(id);
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: AssignBookingDto,
  ) {
    return this.assignments.assign(id, body.employeeId, user.id);
  }

  @Post(':id/reassign')
  reassign(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: AssignBookingDto,
  ) {
    return this.assignments.reassign(id, body.employeeId, user.id);
  }

  @Post(':id/unassign')
  unassign(@Param('id') id: string) {
    return this.assignments.unassign(id);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.assignments.confirmCompletion(id, user.id);
  }

  // ---- Employee wallet (admin/supervisor view) ----
  @Get('employees/:employeeId/wallet')
  employeeWallet(@Param('employeeId') employeeId: string) {
    return this.assignments.getEmployeeWallet(employeeId);
  }

  @Get('employees/:employeeId/wallet/ledger')
  employeeWalletLedger(@Param('employeeId') employeeId: string) {
    return this.assignments.getEmployeeLedger(employeeId);
  }

  // ---- Record a payout (debit) ----
  @Post('employees/:employeeId/wallet/payout')
  recordPayout(
    @CurrentUser() user: { id: string },
    @Param('employeeId') employeeId: string,
    @Body() body: { amount: number; note?: string },
  ) {
    return this.assignments.recordEmployeePayout(
      employeeId,
      body.amount,
      body.note,
      user.id,
    );
  }

  // ---- Set an employee's per-employee payout rate (null => use global) ----
  @Post('employees/:employeeId/payout-rate')
  setPayoutRate(
    @Param('employeeId') employeeId: string,
    @Body() body: { payoutRatePercent: number | null },
  ) {
    return this.assignments.setEmployeePayoutRate(
      employeeId,
      body.payoutRatePercent,
    );
  }
}
