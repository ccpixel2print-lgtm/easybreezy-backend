import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class EmployeeService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ---- List jobs assigned to this employee ----
  async listJobs(employeeId: string, status?: string) {
    const where: Prisma.BookingWhereInput = { assignedEmployeeId: employeeId };
    if (status) {
      where.status = status as BookingStatus;
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

  // ---- Accept a job: ASSIGNED -> ACCEPTED ----
  async acceptJob(employeeId: string, bookingId: string) {
    const booking = await this.getOwnedBooking(employeeId, bookingId);
    if (booking.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Only an ASSIGNED job can be accepted. This job is ${booking.status}.`,
      );
    }
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
      select: { id: true, bookingNumber: true, status: true, acceptedAt: true },
    });
  }

  // ---- Reject a job: ASSIGNED -> REJECTED, then cleared back to CONFIRMED queue ----
  async rejectJob(employeeId: string, bookingId: string, reason?: string) {
    const booking = await this.getOwnedBooking(employeeId, bookingId);
    if (booking.status !== 'ASSIGNED') {
      throw new BadRequestException(
        `Only an ASSIGNED job can be rejected. This job is ${booking.status}.`,
      );
    }
    // Return the booking to the unassigned queue so a supervisor can reassign it.
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CONFIRMED',
        assignedEmployeeId: null,
        assignedById: null,
        assignedAt: null,
        acceptedAt: null,
        rejectedAt: new Date(),
        rejectionReason: reason?.trim() || null,
      },
      select: { id: true, bookingNumber: true, status: true, rejectedAt: true },
    });
  }

  // ---- Start a job: ACCEPTED -> IN_PROGRESS ----
  async startJob(employeeId: string, bookingId: string) {
    const booking = await this.getOwnedBooking(employeeId, bookingId);
    if (booking.status !== 'ACCEPTED') {
      throw new BadRequestException(
        `Only an ACCEPTED job can be started. This job is ${booking.status}.`,
      );
    }
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
      select: { id: true, bookingNumber: true, status: true, startedAt: true },
    });
  }

  // ---- Mark work done: IN_PROGRESS -> AWAITING_CONFIRMATION ----
  async markWorkDone(employeeId: string, bookingId: string, notes?: string) {
    const booking = await this.getOwnedBooking(employeeId, bookingId);
    if (booking.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Only an IN_PROGRESS job can be marked done. This job is ${booking.status}.`,
      );
    }

    const data: {
      status: 'AWAITING_CONFIRMATION';
      workDoneAt: Date;
      notes?: string;
    } = {
      status: 'AWAITING_CONFIRMATION',
      workDoneAt: new Date(),
    };
    if (notes !== undefined && notes.trim()) {
      data.notes = booking.notes
        ? `${booking.notes}\n[work done] ${notes.trim()}`
        : `[work done] ${notes.trim()}`;
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data,
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        workDoneAt: true,
        notes: true,
      },
    });
  }

  // ---- Upload a before/after photo for a job the employee owns ----
  async uploadPhoto(
    employeeId: string,
    bookingId: string,
    kind: 'BEFORE' | 'AFTER',
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    const booking = await this.getOwnedBooking(employeeId, bookingId);

    // Only allow uploads while the job is actively in the employee's hands.
    const uploadable = ['ACCEPTED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];
    if (!uploadable.includes(booking.status)) {
      throw new BadRequestException(
        `Photos can only be added to an active job. This job is ${booking.status}.`,
      );
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('No file was uploaded.');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed.');
    }

    const ext = file.originalname.includes('.')
      ? file.originalname.split('.').pop()!.toLowerCase()
      : 'jpg';
    const objectKey = `bookings/${bookingId}/${kind.toLowerCase()}/${randomUUID()}.${ext}`;

    const stored = await this.storage.upload(
      objectKey,
      file.buffer,
      file.mimetype,
    );

    return this.prisma.bookingPhoto.create({
      data: {
        bookingId,
        kind,
        objectKey: stored.objectKey,
        url: stored.url,
        uploadedBy: employeeId,
      },
      select: { id: true, kind: true, url: true, createdAt: true },
    });
  }
}
