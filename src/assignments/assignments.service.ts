import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// statuses a booking may be in for each action
const ASSIGNABLE = ['CONFIRMED'];
const REASSIGNABLE = ['ASSIGNED', 'IN_PROGRESS'];

@Injectable()
export class AssignmentsService {
  constructor(private prisma: PrismaService) {}

  // ---- Supervisor/admin booking list with filters ----
  // status: optional BookingStatus filter (e.g. CONFIRMED)
  // assigned: 'true' | 'false' to filter by whether an employee is assigned
  // employeeId: filter to one employee's bookings
  async listBookings(query: {
    status?: string;
    assigned?: string;
    employeeId?: string;
  }) {
    const where: any = {};

    if (query.status) {
      where.status = query.status;
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
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        service: { select: { name: true, slug: true } },
        subService: { select: { name: true } },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
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
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        assignedEmployee: { select: { id: true, fullName: true, phone: true } },
        order: { select: { orderNumber: true, status: true, paymentStatus: true } },
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
    const emp = await this.prisma.user.findUnique({ where: { id: employeeId } });
    if (!emp || emp.role !== 'EMPLOYEE') {
      throw new BadRequestException('Selected user is not an employee.');
    }
    if (emp.status !== 'active') {
      throw new BadRequestException('Employee account is not active.');
    }
    return emp;
  }

  // ---- Assign a CONFIRMED booking to an employee ----
  async assign(bookingId: string, employeeId: string, actorId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
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
      },
    });
    return updated;
  }

  // ---- Reassign an already-assigned booking to a different employee ----
  async reassign(bookingId: string, employeeId: string, actorId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found.');

    if (!REASSIGNABLE.includes(booking.status)) {
      throw new BadRequestException(
        `Only ASSIGNED or IN_PROGRESS bookings can be reassigned. This booking is ${booking.status}.`,
      );
    }

    await this.ensureAssignableEmployee(employeeId);

    if (booking.assignedEmployeeId === employeeId) {
      throw new BadRequestException('Booking is already assigned to this employee.');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        assignedEmployeeId: employeeId,
        assignedById: actorId,
        assignedAt: new Date(),
        // if it was IN_PROGRESS, reset to ASSIGNED for the new employee
        status: 'ASSIGNED',
        startedAt: null,
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
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
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
}
