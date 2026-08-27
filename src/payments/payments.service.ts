import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentProvider } from './payment-provider.interface';
import { MockProvider } from './providers/mock.provider';
import { CodProvider } from './providers/cod.provider';
import { PhonePeProvider } from './providers/phonepe.provider';

@Injectable()
export class PaymentsService {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settings: SettingsService,
  ) {
    // Register all known providers once. They are lightweight; gateway clients
    // inside them are constructed lazily on first real use.
    this.register(new MockProvider());
    this.register(new CodProvider());
    this.register(new PhonePeProvider(this.config));
  }

  private register(provider: PaymentProvider) {
    this.providers.set(provider.name, provider);
  }

  /** Resolve the active provider: settings -> env fallback -> 'mock'. */
  async getActiveProviderName(): Promise<string> {
    const payments = await this.settings.getPayments();
    const name =
      payments.activeProvider ||
      (this.config.get<string>('PAYMENT_PROVIDER') ?? 'mock').toLowerCase();
    return this.providers.has(name) ? name : 'mock';
  }

  /** Fetch a specific registered provider (used by the webhook route). */
  getProvider(name: string): PaymentProvider | undefined {
    return this.providers.get(name);
  }

  private async resolveActiveProvider(): Promise<PaymentProvider> {
    const name = await this.getActiveProviderName();
    const provider = this.providers.get(name);
    if (!provider) {
      // Should never happen because getActiveProviderName falls back to mock.
      throw new BadRequestException(`Unknown payment provider "${name}".`);
    }
    return provider;
  }

  // Called right after an order is created. Creates a Payment row and,
  // for COD, immediately confirms bookings into operations.
  async initiatePayment(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const provider = await this.resolveActiveProvider();
    const result = await provider.createPayment(order.id, order.totalAmount);

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: result.provider,
        type: 'full',
        amount: order.totalAmount,
        status: 'PENDING',
        gatewayOrderId: result.gatewayOrderId ?? result.merchantOrderId ?? null,
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
      redirectUrl: result.redirectUrl ?? null,
      merchantOrderId: result.merchantOrderId ?? order.id,
      paymentId: payment.id,
      orderId: order.id,
      amount: order.totalAmount,
    };
  }

  /**
   * Verify a gateway order (called from the return page and/or webhook).
   * Idempotent: if already paid, returns the order unchanged.
   */
  async verifyAndSettle(merchantOrderId: string) {
    // merchantOrderId == our Order.id
    const order = await this.prisma.order.findUnique({
      where: { id: merchantOrderId },
    });
    if (!order) throw new NotFoundException('Order not found.');

    if (order.paymentStatus === 'PAID') {
      return this.prisma.order.findUnique({
        where: { id: order.id },
        include: { bookings: true, payments: true },
      });
    }

    const provider = await this.resolveActiveProvider();
    if (!provider.verifyPayment) {
      throw new BadRequestException(
        `Provider "${provider.name}" does not support verification.`,
      );
    }

    const result = await provider.verifyPayment(merchantOrderId);

    if (result.state === 'PAID') {
      return this.markOrderPaid(order.id, {
        gatewayPaymentId: result.gatewayPaymentId,
      });
    }

    if (result.state === 'FAILED') {
      await this.prisma.payment.updateMany({
        where: { orderId: order.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
    }

    return this.prisma.order.findUnique({
      where: { id: order.id },
      include: { bookings: true, payments: true },
    });
  }

  // MOCK ONLY: simulate a successful payment.
  async mockConfirm(customerId: string, orderId: string) {
    const activeName = await this.getActiveProviderName();
    if (activeName !== 'mock') {
      throw new BadRequestException(
        'Mock confirm is only available in mock mode.',
      );
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Not your order.');
    }

    return this.markOrderPaid(orderId, {
      gatewayPaymentId: `mock_pay_${Date.now()}`,
    });
  }

  // Shared: mark order + payment PAID and confirm bookings. Idempotent-safe:
  // only updates rows still PENDING, so duplicate webhooks are harmless.
  async markOrderPaid(
    orderId: string,
    refs?: { gatewayPaymentId?: string; gatewaySignature?: string },
  ) {
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
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: { bookings: true, payments: true },
    });
  }

  private async confirmBookingsForOps(orderId: string) {
    // COD: bookings become CONFIRMED (enter ops), order paymentStatus stays PENDING.
    await this.prisma.booking.updateMany({
      where: { orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'CONFIRMED' },
    });
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' },
    });
  }
}
