import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { PhonePeProvider } from './providers/phonepe.provider';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  // Lets the frontend know which mode is active (mock/cod/phonepe).
  @Get('mode')
  async mode() {
    return { provider: await this.paymentsService.getActiveProviderName() };
  }

  // MOCK ONLY: simulate paying for an order.
  @UseGuards(JwtGuard)
  @Post('mock/confirm')
  mockConfirm(
    @CurrentUser() user: { id: string },
    @Body('orderId') orderId: string,
  ) {
    return this.paymentsService.mockConfirm(user.id, orderId);
  }

  // PhonePe return page hits this to confirm real status (merchantOrderId == Order.id).
  @Get('phonepe/status')
  phonepeStatus(@Query('orderId') orderId: string) {
    if (!orderId) {
      throw new BadRequestException('orderId is required.');
    }
    return this.paymentsService.verifyAndSettle(orderId);
  }

  // PhonePe server-to-server webhook. No JWT: authenticity is verified by
  // the SDK using the dashboard username/password over the raw body.
  @Post('phonepe/webhook')
  async phonepeWebhook(
    @Headers('authorization') authorization: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const provider = this.paymentsService.getProvider('phonepe');
    if (!(provider instanceof PhonePeProvider)) {
      throw new BadRequestException('PhonePe provider not available.');
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (!rawBody) {
      throw new BadRequestException('Missing webhook body.');
    }

    // Throws if the signature is invalid -> Nest returns 4xx, PhonePe retries.
    const result = provider.validateWebhook(authorization ?? '', rawBody);

    // Acknowledge quickly and idempotently. Non-terminal events -> just ack.
    if (result && result.state === 'PAID') {
      await this.paymentsService.markOrderPaid(result.merchantOrderId, {
        gatewayPaymentId: result.gatewayPaymentId,
      });
    }

    return { ok: true };
  }
}
