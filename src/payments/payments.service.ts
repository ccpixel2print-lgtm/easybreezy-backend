import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProvider } from './payment-provider.interface';
import { MockProvider } from './providers/mock.provider';
import { CodProvider } from './providers/cod.provider';

@Injectable()
export class PaymentsService {
  private provider: PaymentProvider;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const mode = (this.config.get<string>('PAYMENT_PROVIDER') ?? 'mock').toLowerCase();
    this.provider = this.resolveProvider(mode);
  }

  private resolveProvider(mode: string): PaymentProvider {
    switch (mode) {
      case 'cod':
        return new CodProvider();
      case 'mock':
        return new MockProvider();
      // case 'razorpay': return new RazorpayProvider(this.config); // added in 13C
      default:
        return new MockProvider();
    }
  }

  get activeProvider() {
    return this.provider.name;
  }

  // Called right after an order is created. Creates a Payment row and,
  // for COD, immediately confirms bookings into operations.
  async initiatePayment(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');

    const result = await this.provider.createPayment(order.id, order.totalAmount);

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: result.provider,
        type: 'full',
        amount: order.totalAmount,
        status: 'PENDING',
        gatewayOrderId: result.gatewayOrderId ?? null,
      },
    });

    if (result.confirmImmediately) {
      // COD path: bookings enter operations now; payment stays PENDING.
      await this.confirmBookingsForOps(order.id);
    }

    return {
      provider: result.provider,
      confirmImmediately: result.confirmImmediately,
      gatewayOrderId: result.gatewayOrderId ?? null,
      paymentId: payment.id,
      orderId: order.id,
      amount: order.totalAmount,
    };
  }

  // MOCK ONLY: simulate a successful payment.
  async mockConfirm(customerId: string, orderId: string) {
    if (this.provider.name !== 'mock') {
      throw new BadRequestException('Mock confirm is only available in mock mode.');
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.customerId !== customerId) throw new ForbiddenException('Not your order.');

    return this.markOrderPaid(orderId, {
      gatewayPaymentId: `mock_pay_${Date.now()}`,
    });
  }

  // Shared: mark order + payment PAID and confirm bookings.
  async markOrderPaid(orderId: string, refs?: { gatewayPaymentId?: string; gatewaySignature?: string }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'PAID', status: 'PAID' },
      });
      await tx.payment.updateMany({
        where: { orderId, status: 'PENDING' },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          gatewayPaymentId: refs?.gatewayPaymentId ?? null,
          gatewaySignature: refs?.gatewaySignature ?? null,
        },
      });
      await tx.booking.updateMany({
        where: { orderId, status: 'PENDING_PAYMENT' },
        data: { status: 'CONFIRMED' },
      });
    });
    return this.prisma.order.findUnique({ where: { id: orderId }, include: { bookings: true, payments: true } });
  }

  private async confirmBookingsForOps(orderId: string) {
    // COD: bookings become CONFIRMED (enter ops), order paymentStatus stays PENDING.
    await this.prisma.booking.updateMany({
      where: { orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'CONFIRMED' },
    });
    // order.status left as PENDING_PAYMENT? -> use a clearer signal:
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' },
    });
  }
}
