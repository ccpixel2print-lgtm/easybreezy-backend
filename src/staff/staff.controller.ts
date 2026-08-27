import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { CreateStaffDto, UpdateStaffDto } from './staff.dto';

@UseGuards(JwtGuard, RolesGuard)
@Controller('admin/staff')
export class StaffController {
  constructor(private staffService: StaffService) {}

  // Admin or Supervisor can create staff (service enforces the fine-grained rule).
  @Roles('ADMIN', 'SUPERVISOR')
  @Post()
  create(@CurrentUser() user: { role: string }, @Body() body: CreateStaffDto) {
    return this.staffService.createStaff(user.role, body);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Get()
  list(@Query('role') role?: string) {
    return this.staffService.listStaff(role);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.staffService.getStaff(id);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Patch(':id')
  update(
    @CurrentUser() user: { role: string },
    @Param('id') id: string,
    @Body() body: UpdateStaffDto,
  ) {
    return this.staffService.updateStaff(user.role, id, body);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post(':id/reset-password')
  resetPassword(
    @CurrentUser() user: { role: string },
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    return this.staffService.resetPassword(user.role, id, password);
  }
}
