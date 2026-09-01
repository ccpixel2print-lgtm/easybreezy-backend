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
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class PaymentsService {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settings: SettingsService,
    private wallet: WalletService,
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
    // Guard: never settle an order that is already terminal. Protects against
    // a late/duplicate webhook resurrecting a cancelled or refunded order.
    const current = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, paymentStatus: true },
    });
    if (!current) throw new NotFoundException('Order not found.');

    if (current.paymentStatus === 'PAID') {
      // Already settled — idempotent no-op, return the order as-is.
      return this.prisma.order.findUnique({
        where: { id: orderId },
        include: { bookings: true, payments: true },
      });
    }
    if (
      current.status === 'CANCELLED' ||
      current.paymentStatus === 'REFUNDED' ||
      current.paymentStatus === 'PARTIALLY_REFUNDED'
    ) {
      // Terminal/refunded — refuse to settle. A payment landing here needs
      // manual reconciliation (customer paid a cancelled order at the gateway).
      throw new BadRequestException(
        'Cannot settle payment: order is cancelled or refunded.',
      );
    }

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
  /**
   * Admin-triggered order-level full refund / cancellation.
   * - Order.paymentStatus -> REFUNDED (if it was PAID) else the order is just cancelled
   * - Order.status -> CANCELLED
   * - all non-terminal Payment rows -> REFUNDED (paid) or FAILED (pending)
   * - all bookings -> CANCELLED
   * - any employee JOB_CREDIT for those bookings -> REVERSAL clawback
   * Idempotent-guarded: refuses if the order is already CANCELLED/REFUNDED.
   * NOTE: this records the refund in our system. Actual gateway refund
   * (PhonePe money movement) is a separate step — see caveat below.
   */
  async refundOrder(
    orderId: string,
    actorId: string,
    reason?: string,
  ): Promise<{ ok: true }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { bookings: true, payments: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    // Guard: don't re-refund / re-cancel a terminal order.
    if (order.status === 'CANCELLED' || order.paymentStatus === 'REFUNDED') {
      throw new BadRequestException('Order is already cancelled or refunded.');
    }

    const wasPaid = order.paymentStatus === 'PAID';

    // Look up existing JOB_CREDIT entries for these bookings so we claw back
    // the exact amount credited (not a recomputation).
    const bookingIds = order.bookings.map((b) => b.id);
    const credits = bookingIds.length
      ? await this.prisma.walletLedger.findMany({
          where: { bookingId: { in: bookingIds }, type: 'JOB_CREDIT' },
        })
      : [];

    await this.prisma.$transaction(async (tx) => {
      // Order: cancelled; payment status REFUNDED only if money was captured.
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          paymentStatus: wasPaid ? 'REFUNDED' : order.paymentStatus,
        },
      });

      // Payments: paid -> REFUNDED, still-pending -> FAILED.
      await tx.payment.updateMany({
        where: { orderId: order.id, status: 'PAID' },
        data: { status: 'REFUNDED' },
      });
      await tx.payment.updateMany({
        where: { orderId: order.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });

      // Bookings: cancel every one not already in a terminal state.
      await tx.booking.updateMany({
        where: {
          orderId: order.id,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
        data: { status: 'CANCELLED' },
      });

      // Wallet: reverse each recorded job credit (idempotent per booking).
      for (const credit of credits) {
        if (!credit.bookingId) continue;
        await this.wallet.reverseForBooking(
          {
            employeeId: credit.employeeId,
            bookingId: credit.bookingId,
            amount: credit.amount, // JOB_CREDIT is stored positive
            note: reason
              ? `Reversal: ${reason}`
              : 'Order refund/cancellation clawback',
            createdById: actorId,
          },
          tx,
        );
      }
    });

    return { ok: true };
  }

  /**
   * Customer-triggered retry for an order still awaiting payment.
   * Marks any stale PENDING attempt FAILED, then creates a fresh payment
   * attempt via the active provider. Guards against retrying an order that
   * is already paid, cancelled, or refunded.
   */
  async retryPayment(customerId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Not your order.');
    }

    // Guard: only orders genuinely awaiting payment can be retried.
    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('This order is already paid.');
    }
    if (order.status === 'CANCELLED' || order.paymentStatus === 'REFUNDED') {
      throw new BadRequestException('This order can no longer be paid.');
    }

    // Retire any stale pending attempt so only one live attempt exists and
    // a late webhook for the old attempt can't settle the order.
    await this.prisma.payment.updateMany({
      where: { orderId: order.id, status: 'PENDING' },
      data: { status: 'FAILED' },
    });

    // Fresh attempt via the existing initiate path (new Payment row + gateway create).
    return this.initiatePayment(order.id);
  }

  /**
   * Customer-triggered cancel of an order still awaiting payment.
   * Used for the "abandon this attempt and start over" (re-checkout) flow.
   * Deliberately narrow: refuses anything already paid, cancelled, refunded,
   * or with bookings that have advanced into operations.
   */
  async cancelUnpaidOrder(
    customerId: string,
    orderId: string,
  ): Promise<{ ok: true }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Not your order.');
    }

    // Only an unpaid, still-pending order may be cancelled by the customer.
    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException(
        'This order is already paid and cannot be cancelled here.',
      );
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('This order can no longer be cancelled.');
    }

    // Guard the COD edge case: if any booking has already advanced into
    // operations (e.g. COD confirmed bookings), refuse self-cancel — that
    // must go through admin cancel/refund instead.
    const advanced = await this.prisma.booking.count({
      where: {
        orderId: order.id,
        status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
      },
    });
    if (advanced > 0) {
      throw new BadRequestException(
        'This order has active bookings and cannot be self-cancelled.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
      await tx.payment.updateMany({
        where: { orderId: order.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      await tx.booking.updateMany({
        where: { orderId: order.id, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      });
    });

    return { ok: true };
  }

  /**
   * Expire orders that have been stuck in PENDING_PAYMENT past the cutoff.
   * System-triggered (cron/manual). Skips COD and any order whose bookings
   * have advanced into operations. Returns the count expired.
   */
  async expireStalePendingOrders(
    olderThanMinutes = 60,
  ): Promise<{ expired: number }> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    // Candidate orders: still awaiting payment, created before the cutoff,
    // and not yet paid.
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    });

    let expired = 0;
    for (const { id } of stale) {
      // Skip any order whose bookings advanced into ops (e.g. COD confirmed).
      const advanced = await this.prisma.booking.count({
        where: {
          orderId: id,
          status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
        },
      });
      if (advanced > 0) continue;

      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id },
          data: { status: 'CANCELLED' },
        });
        await tx.payment.updateMany({
          where: { orderId: id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
        await tx.booking.updateMany({
          where: { orderId: id, status: 'PENDING_PAYMENT' },
          data: { status: 'CANCELLED' },
        });
      });
      expired += 1;
    }

    return { expired };
  }
}
