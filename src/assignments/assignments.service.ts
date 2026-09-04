import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';

// statuses a booking may be in for each action
const ASSIGNABLE = ['CONFIRMED'];
const REASSIGNABLE = [
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
];
// supervisor/admin can confirm completion only from this state
const CONFIRMABLE = ['AWAITING_CONFIRMATION'];

@Injectable()
export class AssignmentsService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private notifications: NotificationsService,
  ) {}

  // ---- Supervisor/admin booking list with filters ----
  // status: optional BookingStatus filter (e.g. CONFIRMED)
  // assigned: 'true' | 'false' to filter by whether an employee is assigned
  // employeeId: filter to one employee's bookings
  async listBookings(query: {
    status?: string;
    assigned?: string;
    employeeId?: string;
  }) {
    const where: Prisma.BookingWhereInput = {};

    if (query.status) {
      where.status = query.status as BookingStatus;
    }
    if (query.employeeId) {
      where.assignedEmployeeId = query.employeeId;
    }
    if (query.assigned === 'true') {
      where.assignedEmployeeId = { not: null };
    } else if (query.assigned === 'false') {
      where.assignedEmployeeId = null;
    }

    return this.prisma.booking.findMany({
      where,
      // soonest-to-attend first: nearest scheduledDate, then earliest slot,
      // then oldest booking as a stable tie-breaker
      orderBy: [
        { scheduledDate: 'asc' },
        { scheduledTimeWindow: 'asc' },
        { createdAt: 'asc' },
      ],
      include: {
        service: { select: { name: true, slug: true } },
        subService: { select: { name: true } },
        customer: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        order: {
          select: {
            contactName: true,
            contactPhone: true,
            contactEmail: true,
          },
        },
        assignedEmployee: { select: { id: true, fullName: true, phone: true } },
      },
    });
  }

  // ---- Single booking detail ----
  async getBooking(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        service: { select: { name: true, slug: true } },
        subService: { select: { name: true } },
        customer: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        assignedEmployee: { select: { id: true, fullName: true, phone: true } },
        order: {
          select: { orderNumber: true, status: true, paymentStatus: true },
        },
        photos: {
          select: { id: true, kind: true, url: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    return booking;
  }

  // ---- Validate an employee is usable for assignment ----
  private async ensureAssignableEmployee(employeeId: string) {
    if (!employeeId) {
      throw new BadRequestException('employeeId is required.');
    }
    const emp = await this.prisma.user.findUnique({
      where: { id: employeeId },
    });
    if (!emp || emp.role !== 'EMPLOYEE') {
      throw new BadRequestException('Selected user is not an employee.');
    }
    if (emp.status !== 'active') {
      throw new BadRequestException('Employee account is not active.');
    }
    return emp;
  }

  private assignedEmailHtml(
    customerName: string | null,
    techName: string,
    serviceName: string,
    date: string,
    slot: string,
  ): string {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;">
      <h2 style="color:#0d9488;margin:0 0 16px;">Easy Breezy</h2>
      <p style="font-size:15px;line-height:1.5;">Hi ${customerName ?? 'there'},</p>
      <p style="font-size:15px;line-height:1.5;"><strong>${techName}</strong> has been assigned to your <strong>${serviceName}</strong> booking.</p>
      <p style="font-size:15px;line-height:1.5;">Scheduled for <strong>${date}</strong> during <strong>${slot}</strong>.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="font-size:12px;color:#9ca3af;">Easy Breezy · Home services in Hyderabad</p>
    </div>`;
  }

  // ---- Assign a CONFIRMED booking to an employee ----
  async assign(bookingId: string, employeeId: string, actorId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found.');

    if (!ASSIGNABLE.includes(booking.status)) {
      throw new BadRequestException(
        `Only CONFIRMED bookings can be assigned. This booking is ${booking.status}.`,
      );
    }

    await this.ensureAssignableEmployee(employeeId);

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        assignedEmployeeId: employeeId,
        assignedById: actorId,
        assignedAt: new Date(),
        status: 'ASSIGNED',
      },
      include: {
        assignedEmployee: { select: { id: true, fullName: true, phone: true } },
        service: { select: { name: true } },
        customer: { select: { id: true, fullName: true, email: true } },
      },
    });

    // --- Notify the customer: a technician has been assigned (post-commit,
    // best-effort; never blocks or rolls back the assignment). ---
    const techName = updated.assignedEmployee?.fullName ?? 'a technician';
    const when = updated.scheduledDate.toISOString().slice(0, 10);
    void this.notifications.notify({
      userId: updated.customerId,
      type: 'TECHNICIAN_ASSIGNED',
      title: 'A technician has been assigned',
      body: `${techName} will attend your ${updated.service.name} booking on ${when} (${updated.scheduledTimeWindow}).`,
      data: { bookingId: updated.id, orderId: updated.orderId },
      email: updated.customer?.email
        ? {
            to: updated.customer.email,
            subject: 'Your Easy Breezy technician is assigned',
            html: this.assignedEmailHtml(
              updated.customer.fullName,
              techName,
              updated.service.name,
              when,
              updated.scheduledTimeWindow,
            ),
            text: `Hi ${updated.customer.fullName ?? 'there'}, ${techName} will attend your ${updated.service.name} booking on ${when} (${updated.scheduledTimeWindow}).`,
          }
        : undefined,
    });

    // Also notify the assigned employee that they have a new job.
    void this.notifications.notify({
      userId: employeeId,
      type: 'WORK_ASSIGNED',
      title: 'New job assigned',
      body: `You've been assigned ${updated.service.name} on ${when} (${updated.scheduledTimeWindow}).`,
      data: { bookingId: updated.id, orderId: updated.orderId },
    });

    return updated;
  }

  // ---- Reassign an already-assigned booking to a different employee ----
  async reassign(bookingId: string, employeeId: string, actorId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found.');

    if (!REASSIGNABLE.includes(booking.status)) {
      throw new BadRequestException(
        `Only ASSIGNED or IN_PROGRESS bookings can be reassigned. This booking is ${booking.status}.`,
      );
    }

    await this.ensureAssignableEmployee(employeeId);

    if (booking.assignedEmployeeId === employeeId) {
      throw new BadRequestException(
        'Booking is already assigned to this employee.',
      );
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        assignedEmployeeId: employeeId,
        assignedById: actorId,
        assignedAt: new Date(),
        // fresh start for the new employee: clear all prior workflow progress
        status: 'ASSIGNED',
        acceptedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        startedAt: null,
        workDoneAt: null,
      },
      include: {
        assignedEmployee: { select: { id: true, fullName: true, phone: true } },
        service: { select: { name: true } },
      },
    });
    return updated;
  }

  // ---- Unassign: clear employee, return booking to the queue ----
  async unassign(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found.');

    if (!REASSIGNABLE.includes(booking.status)) {
      throw new BadRequestException(
        `Only ASSIGNED or IN_PROGRESS bookings can be unassigned. This booking is ${booking.status}.`,
      );
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        assignedEmployeeId: null,
        assignedById: null,
        assignedAt: null,
        startedAt: null,
        status: 'CONFIRMED',
      },
    });
    return updated;
  }
  // ---- Supervisor/admin confirm completion: AWAITING_CONFIRMATION -> COMPLETED ----
  // Terminal state. Status flip and wallet credit happen in ONE transaction:
  // either both commit or both roll back.
  async confirmCompletion(bookingId: string, actorId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          assignedEmployee: { select: { id: true, payoutRatePercent: true } },
        },
      });
      if (!booking) throw new NotFoundException('Booking not found.');

      if (!CONFIRMABLE.includes(booking.status)) {
        throw new BadRequestException(
          `Only a job AWAITING_CONFIRMATION can be completed. This booking is ${booking.status}.`,
        );
      }
      if (!booking.assignedEmployeeId || !booking.assignedEmployee) {
        throw new BadRequestException(
          'Cannot complete a booking with no assigned employee.',
        );
      }

      const done = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'COMPLETED',
          confirmedAt: new Date(),
          confirmedById: actorId,
          completedAt: new Date(),
        },
        include: {
          assignedEmployee: {
            select: { id: true, fullName: true, phone: true },
          },
          service: { select: { name: true } },
          customer: { select: { id: true, fullName: true, email: true } },
        },
      });

      await this.wallet.creditForCompletion(tx, {
        bookingId: booking.id,
        employeeId: booking.assignedEmployeeId,
        employeePayoutRatePercent: booking.assignedEmployee.payoutRatePercent,
        serviceAmount: booking.serviceAmount,
      });

      return done;
    });

    // Post-commit notifications (best-effort). `updated` is fully typed and
    // non-null here — it's the resolved value of the transaction above.
    void this.notifications.notify({
      userId: updated.customerId,
      type: 'WORK_COMPLETED',
      title: 'Your service is complete',
      body: `Your ${updated.service.name} booking has been completed. Thank you for choosing Easy Breezy!`,
      data: { bookingId: updated.id, orderId: updated.orderId },
      email: updated.customer?.email
        ? {
            to: updated.customer.email,
            subject: 'Your Easy Breezy service is complete',
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;"><h2 style="color:#0d9488;">Easy Breezy</h2><p>Hi ${updated.customer.fullName ?? 'there'},</p><p>Your <strong>${updated.service.name}</strong> booking has been completed. We hope everything went well!</p></div>`,
            text: `Hi ${updated.customer.fullName ?? 'there'}, your ${updated.service.name} booking is complete.`,
          }
        : undefined,
    });

    if (updated.assignedEmployeeId) {
      void this.notifications.notify({
        userId: updated.assignedEmployeeId,
        type: 'JOB_COMPLETED',
        title: 'Job completed',
        body: `Your ${updated.service.name} job (${updated.bookingNumber}) was confirmed complete. Earnings have been credited to your wallet.`,
        data: { bookingId: updated.id },
      });
    }

    return updated;
  }

  // ---- Wallet: admin/supervisor read + write ----

  async getEmployeeWallet(employeeId: string) {
    await this.ensureEmployeeExists(employeeId);
    return this.wallet.getSummary(employeeId);
  }

  async getEmployeeLedger(employeeId: string) {
    await this.ensureEmployeeExists(employeeId);
    return this.wallet.getLedger(employeeId);
  }

  async recordEmployeePayout(
    employeeId: string,
    amount: number,
    note: string | undefined,
    actorId: string,
  ) {
    await this.ensureEmployeeExists(employeeId);
    return this.wallet.recordPayout({
      employeeId,
      amount,
      note,
      createdById: actorId,
    });
  }

  async setEmployeePayoutRate(
    employeeId: string,
    payoutRatePercent: number | null,
  ) {
    await this.ensureEmployeeExists(employeeId);
    if (payoutRatePercent !== null) {
      if (
        !Number.isInteger(payoutRatePercent) ||
        payoutRatePercent < 0 ||
        payoutRatePercent > 100
      ) {
        throw new BadRequestException(
          'payoutRatePercent must be an integer between 0 and 100, or null.',
        );
      }
    }
    return this.prisma.user.update({
      where: { id: employeeId },
      data: { payoutRatePercent },
      select: { id: true, fullName: true, payoutRatePercent: true },
    });
  }

  // small guard reused by the wallet endpoints
  private async ensureEmployeeExists(employeeId: string) {
    const emp = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: { id: true, role: true },
    });
    if (!emp || emp.role !== 'EMPLOYEE') {
      throw new NotFoundException('Employee not found.');
    }
  }
}
