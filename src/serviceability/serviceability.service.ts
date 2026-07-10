import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServiceabilityService {
  constructor(private prisma: PrismaService) {}

  async check(pincode: string) {
    const match = await this.prisma.serviceablePincode.findFirst({
      where: { pincode, active: true },
    });
    return {
      serviceable: !!match,
      pincode,
      areaName: match?.areaName ?? null,
      city: match?.city ?? null,
    };
  }

  async captureLead(data: { pincode: string; email?: string; phone?: string; serviceId?: string }) {
    await this.prisma.areaLead.create({ data });
    return { captured: true };
  }
}
