import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto, UpdateStaffDto } from './staff.dto';
import * as bcrypt from 'bcrypt';

const STAFF_ROLES = ['EMPLOYEE', 'SUPERVISOR'] as const;

@Injectable()
export class StaffService {
  constructor(private prisma: PrismaService) {}

  // ---- Create a staff member (EMPLOYEE or SUPERVISOR) ----
  // actorRole = role of the logged-in user making the request.
  async createStaff(actorRole: string, dto: CreateStaffDto) {
    const fullName = (dto.fullName ?? '').trim();
    const email = (dto.email ?? '').trim().toLowerCase();
    const phone = dto.phone?.trim() || null;
    const role = dto.role;
    const password = dto.password ?? '';

    if (!fullName) throw new BadRequestException('Full name is required.');
    if (!email || !email.includes('@')) {
      throw new BadRequestException('A valid email is required.');
    }
    if (!STAFF_ROLES.includes(role)) {
      throw new BadRequestException('Role must be EMPLOYEE or SUPERVISOR.');
    }
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    // Permission rules:
    //  - ADMIN can create both EMPLOYEE and SUPERVISOR
    //  - SUPERVISOR can create only EMPLOYEE
    if (role === 'SUPERVISOR' && actorRole !== 'ADMIN') {
      throw new ForbiddenException('Only an admin can create supervisors.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists.');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        fullName,
        email,
        phone,
        role,
        passwordHash,
        status: 'active',
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    return user;
  }

  // ---- List staff, optionally filtered by role ----
  async listStaff(role?: string) {
    const where: any = { role: { in: ['EMPLOYEE', 'SUPERVISOR'] } };
    if (role && STAFF_ROLES.includes(role as any)) {
      where.role = role;
    }
    return this.prisma.user.findMany({
      where,
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        payoutRatePercent: true,
      },
    });
  }

  // ---- Get one staff member ----
  async getStaff(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        payoutRatePercent: true,
      },
    });
    if (!user || !STAFF_ROLES.includes(user.role as any)) {
      throw new NotFoundException('Staff member not found.');
    }
    return user;
  }

  // ---- Update profile / status ----
  async updateStaff(actorRole: string, id: string, dto: UpdateStaffDto) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || !STAFF_ROLES.includes(target.role as any)) {
      throw new NotFoundException('Staff member not found.');
    }

    // Only an admin may change a supervisor.
    if (target.role === 'SUPERVISOR' && actorRole !== 'ADMIN') {
      throw new ForbiddenException('Only an admin can modify supervisors.');
    }

    const data: any = {};
    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim();
      if (!fullName)
        throw new BadRequestException('Full name cannot be empty.');
      data.fullName = fullName;
    }
    if (dto.phone !== undefined) {
      data.phone = dto.phone.trim() || null;
    }
    if (dto.status !== undefined) {
      if (!['active', 'inactive', 'suspended'].includes(dto.status)) {
        throw new BadRequestException('Invalid status.');
      }
      data.status = dto.status;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No changes provided.');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });
    return user;
  }

  // ---- Reset a staff member's password ----
  async resetPassword(actorRole: string, id: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || !STAFF_ROLES.includes(target.role as any)) {
      throw new NotFoundException('Staff member not found.');
    }
    if (target.role === 'SUPERVISOR' && actorRole !== 'ADMIN') {
      throw new ForbiddenException(
        'Only an admin can reset a supervisor password.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
    return { ok: true, message: 'Password updated.' };
  }
}
