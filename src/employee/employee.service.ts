import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmployeeService {
  constructor(private prisma: PrismaService) {}

  // ---- List jobs assigned to this employee ----
  async listJobs(employeeId: string, status?: string) {
    const where: any = { assignedEmployeeId: employeeId };
    if (status) {
      where.status = status;
    }

    return this.prisma.booking.findMany({
      where,
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        bookingNumber: true,
        itemName: true,
        status: true,
        scheduledDate: true,
        scheduledTimeWindow: true,
        addressLine1: true,
        addressLine2: true,
        area: true,
        city: true,
        pincode: true,
        startedAt: true,
        completedAt: true,
        assignedAt: true,
        // customer contact so the employee can reach the customer
        customer: { select: { fullName: true, phone: true } },
        service: { select: { name: true } },
        subService: { select: { name: true } },
      },
    });
  }

  // ---- Fetch a single job, enforcing ownership ----
  private async getOwnedBooking(employeeId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Job not found.');
    if (booking.assignedEmployeeId !== employeeId) {
      // Don't reveal existence of jobs that aren't theirs.
      throw new ForbiddenException('This job is not assigned to you.');
    }
    return booking;
  }

  // ---- Job detail ----
  async getJob(employeeId: string, bookingId: string) {
    await this.getOwnedBooking(employeeId, bookingId);
    return this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingNumber: true,
        itemName: true,
        status: true,
        pricingType: true,
        quantity: true,
        scheduledDate: true,
        scheduledTimeWindow: true,
        addressLine1: true,
        addressLine2: true,
        area: true,
        city: true,
        pincode: true,
        notes: true,
        startedAt: true,
        completedAt: true,
        assignedAt: true,
        customer: { select: { fullName: true, phone: true, email: true } },
        service: { select: { name: true } },
        subService: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
    });
  }

  // ---- Start a job: ASSIGNED -> IN_PROGRESS ----
  async startJob(employeeId: string, bookingId: string) {
    const booking = await this.getOwnedBooking(employeeId, bookingId);

    if (booking.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Only an ASSIGNED job can be started. This job is ${booking.status}.`,
      );
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        startedAt: true,
      },
    });
  }

  // ---- Complete a job: IN_PROGRESS -> COMPLETED ----
  async completeJob(employeeId: string, bookingId: string, notes?: string) {
    const booking = await this.getOwnedBooking(employeeId, bookingId);

    if (booking.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Only an IN_PROGRESS job can be completed. This job is ${booking.status}.`,
      );
    }

    const data: any = {
      status: 'COMPLETED',
      completedAt: new Date(),
    };
    if (notes !== undefined && notes.trim()) {
      // append to any existing notes rather than overwrite
      data.notes = booking.notes
        ? `${booking.notes}\n[completion] ${notes.trim()}`
        : `[completion] ${notes.trim()}`;
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data,
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        startedAt: true,
        completedAt: true,
        notes: true,
      },
    });
  }
}
