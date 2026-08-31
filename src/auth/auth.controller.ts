import { UseGuards } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';
import { CurrentUser } from './current-user.decorator';
import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { UpdateMeDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('ping')
  ping() {
    return this.authService.ping();
  }

  @Post('customer/request-otp')
  requestOtp(@Body('email') email: string) {
    return this.authService.requestOtp(email);
  }

  @Post('customer/verify-otp')
  verifyOtp(@Body('email') email: string, @Body('code') code: string) {
    return this.authService.verifyOtp(email, code);
  }

  @Post('staff/login')
  staffLogin(@Body('email') email: string, @Body('password') password: string) {
    return this.authService.staffLogin(email, password);
  }

  @UseGuards(JwtGuard)
  @Get('me')
  @Patch('me')
  updateMe(@CurrentUser() user: { id: string }, @Body() body: UpdateMeDto) {
    return this.authService.updateMe(user.id, body);
  }
  me(@CurrentUser() user: { id: string }) {
    return this.authService.getMe(user.id);
  }
}
