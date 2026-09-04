import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';

// Prisma transaction client type — lets wallet writes enlist in a caller's
// $transaction so credit + status-flip are atomic.
type Tx = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Resolve an employee's effective payout percent:
   * per-employee rate if set, otherwise the global default from settings.
   */
  private async resolveRate(
    employeePayoutRatePercent: number | null,
  ): Promise<number> {
    if (
      employeePayoutRatePercent !== null &&
      employeePayoutRatePercent !== undefined
    ) {
      return employeePayoutRatePercent;
    }
    const payouts = await this.settings.getPayouts();
    return payouts.defaultPayoutPercent;
  }

  /**
   * Credit an employee's wallet for a completed booking.
   * Idempotent via the @@unique([bookingId, type]) constraint on WalletLedger:
   * a duplicate JOB_CREDIT for the same booking is silently ignored.
   *
   * Runs on the passed-in transaction client so it commits/rolls back
   * atomically with the booking status flip.
   */
  async creditForCompletion(
    tx: Tx,
    params: {
      bookingId: string;
      employeeId: string;
      employeePayoutRatePercent: number | null;
      serviceAmount: number; // paise, pre-tax service charge
    },
  ): Promise<void> {
    const { bookingId, employeeId, employeePayoutRatePercent, serviceAmount } =
      params;

    if (serviceAmount <= 0) {
      // nothing to credit (e.g. zero-priced/edge booking); skip cleanly
      return;
    }

    const pct = await this.resolveRate(employeePayoutRatePercent);
    const amount = Math.round((serviceAmount * pct) / 100);
    if (amount <= 0) return;

    try {
      await tx.walletLedger.create({
        data: {
          employeeId,
          type: 'JOB_CREDIT',
          amount, // positive = credit
          bookingId,
          note: `Job credit @ ${pct}% of ₹${(serviceAmount / 100).toFixed(2)}`,
        },
      });
    } catch (e) {
      // P2002 = unique constraint violation => credit already exists for this
      // booking. Idempotent: treat as success, don't double-credit.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return;
      }
      throw e;
    }
  }

  // ---------- read models ----------

  /** Current balance in paise = SUM(amount) across all entries. */
  async getBalance(employeeId: string): Promise<number> {
    const agg = await this.prisma.walletLedger.aggregate({
      where: { employeeId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  /** Full ledger for an employee, newest first. */
  async getLedger(employeeId: string) {
    return this.prisma.walletLedger.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Summary: balance + totals by category, for dashboards. */
  async getSummary(employeeId: string) {
    const entries = await this.prisma.walletLedger.findMany({
      where: { employeeId },
      select: { type: true, amount: true },
    });

    let balance = 0;
    let totalEarned = 0;
    let totalPaidOut = 0;
    let totalReversed = 0;
    let totalAdjusted = 0;

    for (const e of entries) {
      balance += e.amount;
      if (e.type === 'JOB_CREDIT') totalEarned += e.amount;
      else if (e.type === 'PAYOUT')
        totalPaidOut += -e.amount; // stored negative
      else if (e.type === 'REVERSAL') totalReversed += -e.amount;
      else if (e.type === 'ADJUSTMENT') totalAdjusted += e.amount;
    }

    return { balance, totalEarned, totalPaidOut, totalReversed, totalAdjusted };
  }

  // ---------- write models for staff-initiated entries ----------

  /**
   * Record a payout (money physically paid to the employee).
   * Stored as a negative amount so it reduces the wallet balance.
   */
  async recordPayout(params: {
    employeeId: string;
    amount: number; // positive paise to pay out
    note?: string;
    createdById: string;
  }) {
    const { employeeId, amount, note, createdById } = params;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException(
        'Payout amount must be a positive integer (paise).',
      );
    }
    const balance = await this.getBalance(employeeId);
    if (amount > balance) {
      throw new BadRequestException(
        `Payout (₹${(amount / 100).toFixed(2)}) exceeds wallet balance (₹${(balance / 100).toFixed(2)}).`,
      );
    }

    const entry = await this.prisma.walletLedger.create({
      data: {
        employeeId,
        type: 'PAYOUT',
        amount: -amount, // negative = debit
        note: note ?? 'Payout',
        createdById,
      },
    });

    // Post-write employee notification (best-effort).
    const emp = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: { fullName: true, email: true },
    });
    void this.notifications.notify({
      userId: employeeId,
      type: 'PAYOUT_RECEIVED',
      title: 'Payout received',
      body: `A payout of ₹${(amount / 100).toFixed(2)} has been recorded to your account.`,
      data: { amount, ledgerId: entry.id },
      email: emp?.email
        ? {
            to: emp.email,
            subject: 'Easy Breezy — payout recorded',
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;"><h2 style="color:#0d9488;">Easy Breezy</h2><p>Hi ${emp.fullName ?? 'there'},</p><p>A payout of <strong>₹${(amount / 100).toFixed(2)}</strong> has been recorded to your account.</p></div>`,
            text: `Hi ${emp.fullName ?? 'there'}, a payout of ₹${(amount / 100).toFixed(2)} has been recorded.`,
          }
        : undefined,
    });

    return entry;
  }

  /**
   * Reverse a completed job's credit (refund/cancellation clawback).
   * Stored as a negative amount tied to the booking.
   * Idempotent per booking via @@unique([bookingId, type]).
   */
  async reverseForBooking(
    params: {
      employeeId: string;
      bookingId: string;
      amount: number; // positive paise to claw back
      note?: string;
      createdById: string;
    },
    tx?: Tx,
  ) {
    const { employeeId, bookingId, amount, note, createdById } = params;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException(
        'Reversal amount must be a positive integer (paise).',
      );
    }
    const db = tx ?? this.prisma; // enlist in caller's transaction if given
    try {
      return await db.walletLedger.create({
        data: {
          employeeId,
          type: 'REVERSAL',
          amount: -amount, // negative = debit
          bookingId,
          note: note ?? 'Refund/cancellation clawback',
          createdById,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'This booking has already been reversed.',
        );
      }
      throw e;
    }
  }
}
