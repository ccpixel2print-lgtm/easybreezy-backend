import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  // All active categories, ordered
  async getCategories() {
    return this.prisma.serviceCategory.findMany({
      where: { active: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  // All active services (optionally filtered by category), ordered
  async getServices(categoryId?: string) {
    return this.prisma.service.findMany({
      where: {
        active: true,
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: { displayOrder: 'asc' },
      include: {
        category: true,
      },
    });
  }

  // One service by slug, including its active sub-services
  async getServiceBySlug(slug: string) {
    const service = await this.prisma.service.findUnique({
      where: { slug },
      include: {
        category: true,
        subServices: {
          where: { active: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    if (!service || !service.active) {
      throw new NotFoundException(`Service "${slug}" not found`);
    }

    return service;
  }
}
