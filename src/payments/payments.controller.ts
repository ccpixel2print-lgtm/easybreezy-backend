import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  // Lets the frontend know which mode is active (mock/cod/razorpay)
  @Get('mode')
  mode() {
    return { provider: this.paymentsService.activeProvider };
  }

  // MOCK ONLY: simulate paying for an order
  @UseGuards(JwtGuard)
  @Post('mock/confirm')
  mockConfirm(@CurrentUser() user: { id: string }, @Body('orderId') orderId: string) {
    return this.paymentsService.mockConfirm(user.id, orderId);
  }
}
