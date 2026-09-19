import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { QuoteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';

// A quote can only be raised while the technician is on-site working.
const QUOTE_RAISABLE_BOOKING_STATUS = 'IN_PROGRESS';
// Quote statuses that count as "open" — only one allowed at a time in v1.
const OPEN_QUOTE_STATUSES: QuoteStatus[] = ['DRAFT', 'AWAITING_PAYMENT'];

export interface RaiseQuoteItemInput {
  name: string;
  description?: string;
  amount: number; // paise, unit price
  quantity?: number; // default 1
}

export interface RaiseQuoteInput {
  items: RaiseQuoteItemInput[];
}

@Injectable()
export class QuotesService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private payments: PaymentsService,
    private notifications: NotificationsService,
  ) {}

  // ---------- helpers ----------

  /** Validate + normalise incoming line items into positive-integer paise. */
  private normaliseItems(items: RaiseQuoteItemInput[]) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('A quote needs at least one line item.');
    }
    return items.map((raw, i) => {
      const name = (raw.name ?? '').trim();
      if (!name) {
        throw new BadRequestException(`Item ${i + 1}: name is required.`);
      }
      const amount = Number(raw.amount);
      const quantity = raw.quantity == null ? 1 : Number(raw.quantity);
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new BadRequestException(
          `Item ${i + 1}: amount must be a positive integer (paise).`,
        );
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException(
          `Item ${i + 1}: quantity must be a positive integer.`,
        );
      }
      const description = raw.description?.trim() || null;
      return {
        name,
        description,
        amount,
        quantity,
        lineTotal: amount * quantity,
      };
    });
  }

  /** GST snapshot from settings. Returns basis points + computed tax. */
  private async computeTotals(subtotal: number) {
    const pricing = await this.settings.getPricing();
    if (!pricing.gstEnabled) {
      return { gstRate: 0, taxAmount: 0, totalAmount: subtotal };
    }
    // settings store gstRate as a decimal (e.g. 0.18); snapshot as basis points.
    const gstRate = Math.round(pricing.gstRate * 10000); // 0.18 -> 1800
    const taxAmount = Math.round((subtotal * gstRate) / 10000);
    return { gstRate, taxAmount, totalAmount: subtotal + taxAmount };
  }

  /** Human-readable quote number, e.g. Q-2026-000042. */
  private async nextQuoteNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.bookingQuote.count();
    const seq = String(count + 1).padStart(6, '0');
    return `Q-${year}-${seq}`;
  }

  // ---------- the shared brain ----------

  /**
   * Raise an extra-work quote. Called by BOTH the employee route and the
   * supervisor/admin route. Caller supplies who is raising it and, for
   * staff-side raises, the technician it's on behalf of is inferred from
   * the booking's assigned employee.
   */
  async raiseQuote(params: {
    bookingId: string;
    input: RaiseQuoteInput;
    actor: { id: string; role: 'EMPLOYEE' | 'SUPERVISOR' | 'ADMIN' };
  }) {
    const { bookingId, input, actor } = params;

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        assignedEmployeeId: true,
        customerId: true,
        itemName: true,
        orderId: true,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found.');

    // Employees may only quote on their own job.
    if (actor.role === 'EMPLOYEE' && booking.assignedEmployeeId !== actor.id) {
      throw new ForbiddenException('This job is not assigned to you.');
    }

    // Rule: only IN_PROGRESS jobs can have a quote (v1).
    if (booking.status !== QUOTE_RAISABLE_BOOKING_STATUS) {
      throw new BadRequestException(
        'A quote can only be raised while the job is in progress.',
      );
    }

    // Rule: one open quote at a time (v1). Lifted in a future version.
    const openCount = await this.prisma.bookingQuote.count({
      where: { bookingId, status: { in: OPEN_QUOTE_STATUSES } },
    });
    if (openCount > 0) {
      throw new BadRequestException(
        'There is already an open quote on this job. Cancel or settle it first.',
      );
    }

    const items = this.normaliseItems(input.items);
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
    const { gstRate, taxAmount, totalAmount } =
      await this.computeTotals(subtotal);

    const raisedByType = actor.role === 'EMPLOYEE' ? 'EMPLOYEE' : 'SUPERVISOR';
    const onBehalfOfEmployeeId =
      actor.role === 'EMPLOYEE' ? null : booking.assignedEmployeeId;

    const quoteNumber = await this.nextQuoteNumber();

    // Create quote + items, then flip booking to AWAITING_QUOTE, atomically.
    const quote = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bookingQuote.create({
        data: {
          bookingId,
          parentOrderId: booking.orderId,
          quoteNumber,
          status: 'AWAITING_PAYMENT',
          raisedByType,
          raisedById: actor.id,
          onBehalfOfEmployeeId,
          subtotal,
          gstRate,
          taxAmount,
          totalAmount,
          items: {
            create: items.map((it) => ({
              name: it.name,
              description: it.description,
              amount: it.amount,
              quantity: it.quantity,
              lineTotal: it.lineTotal,
            })),
          },
        },
        include: { items: true },
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'AWAITING_QUOTE' },
      });

      // Customer in-app notification, atomic with the change.
      await this.notifications.notify(
        {
          userId: booking.customerId,
          type: 'QUOTE_RAISED',
          title: 'Extra work quote raised',
          body: `A quote of ₹${(totalAmount / 100).toFixed(2)} for extra work on booking ${booking.bookingNumber} is awaiting your payment.`,
          data: { bookingId, quoteId: created.id, quoteNumber },
        },
        tx,
      );

      return created;
    });

    return quote;
  }

  // ---------- customer-facing payment ----------

  /** Customer initiates payment for an open quote. Reuses the gateway flow. */
  async payQuote(customerId: string, quoteId: string) {
    const quote = await this.prisma.bookingQuote.findUnique({
      where: { id: quoteId },
      include: { booking: { select: { customerId: true } } },
    });
    if (!quote) throw new NotFoundException('Quote not found.');
    if (quote.booking.customerId !== customerId) {
      throw new ForbiddenException('Not your quote.');
    }
    if (quote.status !== 'AWAITING_PAYMENT') {
      throw new BadRequestException('This quote is not awaiting payment.');
    }
    // Delegates to a PaymentsService method we add in the next step.
    return this.payments.initiateQuotePayment(quoteId);
  }

  // ---------- staff: edit / cancel ----------

  /** Cancel/close an open quote. Booking returns to IN_PROGRESS. */
  async cancelQuote(actor: { id: string; role: string }, quoteId: string) {
    const quote = await this.prisma.bookingQuote.findUnique({
      where: { id: quoteId },
      include: {
        booking: {
          select: {
            id: true,
            assignedEmployeeId: true,
            customerId: true,
            bookingNumber: true,
          },
        },
      },
    });
    if (!quote) throw new NotFoundException('Quote not found.');
    if (quote.status === 'PAID') {
      throw new BadRequestException('A paid quote cannot be cancelled here.');
    }
    if (quote.status === 'CANCELLED') return quote; // idempotent

    if (
      actor.role === 'EMPLOYEE' &&
      quote.booking.assignedEmployeeId !== actor.id
    ) {
      throw new ForbiddenException('This job is not assigned to you.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const q = await tx.bookingQuote.update({
        where: { id: quoteId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      // Return the job to IN_PROGRESS so the tech can finish/leave.
      await tx.booking.update({
        where: { id: quote.booking.id },
        data: { status: 'IN_PROGRESS' },
      });
      await this.notifications.notify(
        {
          userId: quote.booking.customerId,
          type: 'QUOTE_CANCELLED',
          title: 'Extra work quote cancelled',
          body: `The extra work quote ${quote.quoteNumber} on booking ${quote.booking.bookingNumber} has been cancelled.`,
          data: { bookingId: quote.booking.id, quoteId },
        },
        tx,
      );
      return q;
    });
    return updated;
  }

  /**
   * Edit = re-issue. We cancel the current open quote (voiding any pending
   * payment attempt) and raise a fresh one with the new items, so a customer
   * mid-payment can never pay a stale amount. Simpler and safer than mutating
   * a live quote+payment.
   */
  async editQuote(
    actor: { id: string; role: 'EMPLOYEE' | 'SUPERVISOR' | 'ADMIN' },
    quoteId: string,
    input: RaiseQuoteInput,
  ) {
    const quote = await this.prisma.bookingQuote.findUnique({
      where: { id: quoteId },
      select: { id: true, status: true, bookingId: true },
    });
    if (!quote) throw new NotFoundException('Quote not found.');
    if (quote.status !== 'AWAITING_PAYMENT' && quote.status !== 'DRAFT') {
      throw new BadRequestException('Only an open quote can be edited.');
    }
    await this.cancelQuote(actor, quoteId);
    return this.raiseQuote({ bookingId: quote.bookingId, input, actor });
  }
}
