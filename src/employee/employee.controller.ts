import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EmployeeService } from './employee.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RejectJobDto, WorkDoneDto } from './employee.dto';

@UseGuards(JwtGuard, RolesGuard)
@Roles('EMPLOYEE')
@Controller('employee/jobs')
export class EmployeeController {
  constructor(private employee: EmployeeService) {}

  @Get()
  list(@CurrentUser() user: { id: string }, @Query('status') status?: string) {
    return this.employee.listJobs(user.id, status);
  }

  @Get(':id')
  getOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.employee.getJob(user.id, id);
  }

  @Post(':id/accept')
  accept(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.employee.acceptJob(user.id, id);
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: RejectJobDto,
  ) {
    return this.employee.rejectJob(user.id, id, body?.reason);
  }

  @Post(':id/start')
  start(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.employee.startJob(user.id, id);
  }

  @Post(':id/work-done')
  workDone(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: WorkDoneDto,
  ) {
    return this.employee.markWorkDone(user.id, id, body?.notes);
  }

  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('kind') kind: string,
    @UploadedFile()
    file?: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
    },
  ) {
    const k = (kind || '').toUpperCase();
    if (k !== 'BEFORE' && k !== 'AFTER') {
      throw new BadRequestException("kind must be 'before' or 'after'.");
    }
    if (!file) throw new BadRequestException('No file was uploaded.');
    return this.employee.uploadPhoto(user.id, id, k, file);
  }
}
