import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { CompleteJobDto } from './employee.dto';

@UseGuards(JwtGuard, RolesGuard)
@Roles('EMPLOYEE')
@Controller('employee/jobs')
export class EmployeeController {
  constructor(private employee: EmployeeService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query('status') status?: string,
  ) {
    return this.employee.listJobs(user.id, status);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.employee.getJob(user.id, id);
  }

  @Post(':id/start')
  start(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.employee.startJob(user.id, id);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: CompleteJobDto,
  ) {
    return this.employee.completeJob(user.id, id, body?.notes);
  }
}
