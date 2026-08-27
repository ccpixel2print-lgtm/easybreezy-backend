import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateServiceDto,
  UpdateServiceDto,
  CreateSubServiceDto,
  UpdateSubServiceDto,
  CreatePincodeDto,
  UpdatePincodeDto,
} from './catalog-admin.dto';

const PRICING = ['FIXED', 'HOURLY', 'VISITING'];

@Injectable()
export class CatalogAdminService {
  constructor(private prisma: PrismaService) {}

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private assertPaise(label: string, val?: number) {
    if (val === undefined || val === null) return;
    if (!Number.isInteger(val) || val < 0) {
      throw new BadRequestException(
        `${label} must be a non-negative integer (paise).`,
      );
    }
  }

  // ============ CATEGORIES ============

  listCategories() {
    return this.prisma.serviceCategory.findMany({
      orderBy: { displayOrder: 'asc' },
      include: { _count: { select: { services: true } } },
    });
  }

  async createCategory(dto: CreateCategoryDto) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Category name is required.');

    const existing = await this.prisma.serviceCategory.findUnique({
      where: { name },
    });
    if (existing)
      throw new ConflictException('A category with this name already exists.');

    return this.prisma.serviceCategory.create({
      data: {
        name,
        displayOrder: dto.displayOrder ?? 0,
        active: dto.active ?? true,
      },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const cat = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found.');

    const data: any = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name cannot be empty.');
      data.name = name;
    }
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.active !== undefined) data.active = dto.active;

    return this.prisma.serviceCategory.update({ where: { id }, data });
  }

  async deleteCategory(id: string) {
    const cat = await this.prisma.serviceCategory.findUnique({
      where: { id },
      include: { _count: { select: { services: true } } },
    });
    if (!cat) throw new NotFoundException('Category not found.');
    if (cat._count.services > 0) {
      throw new BadRequestException(
        'Cannot delete a category that still has services. Move or delete its services first, or deactivate it instead.',
      );
    }
    await this.prisma.serviceCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ============ SERVICES ============

  listServices(categoryId?: string) {
    return this.prisma.service.findMany({
      where: categoryId ? { categoryId } : {},
      orderBy: { displayOrder: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { subServices: true } },
      },
    });
  }

  async getService(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        category: true,
        subServices: { orderBy: { displayOrder: 'asc' } },
      },
    });
    if (!service) throw new NotFoundException('Service not found.');
    return service;
  }

  async createService(dto: CreateServiceDto) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Service name is required.');
    if (!dto.categoryId)
      throw new BadRequestException('categoryId is required.');

    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category)
      throw new BadRequestException(
        'categoryId does not refer to a valid category.',
      );

    if (dto.pricingType && !PRICING.includes(dto.pricingType)) {
      throw new BadRequestException(
        'pricingType must be FIXED, HOURLY, or VISITING.',
      );
    }
    this.assertPaise('basePrice', dto.basePrice);
    this.assertPaise('hourlyRate', dto.hourlyRate);
    this.assertPaise('visitFee', dto.visitFee);
    this.assertPaise('startingPrice', dto.startingPrice);

    const slug = this.slugify(dto.slug || name);
    if (!slug) throw new BadRequestException('Could not derive a valid slug.');
    const slugTaken = await this.prisma.service.findUnique({ where: { slug } });
    if (slugTaken)
      throw new ConflictException(`Slug "${slug}" is already in use.`);

    return this.prisma.service.create({
      data: {
        categoryId: dto.categoryId,
        name,
        slug,
        description: dto.description ?? null,
        longDescription: dto.longDescription ?? null,
        imageUrl: dto.imageUrl ?? null,
        imageAlt: dto.imageAlt ?? null,
        hasSubServices: dto.hasSubServices ?? false,
        pricingType: dto.pricingType ?? null,
        basePrice: dto.basePrice ?? null,
        hourlyRate: dto.hourlyRate ?? null,
        visitFee: dto.visitFee ?? null,
        durationLabel: dto.durationLabel ?? null,
        startingPrice: dto.startingPrice ?? null,
        displayOrder: dto.displayOrder ?? 0,
        active: dto.active ?? true,
      },
    });
  }

  async updateService(id: string, dto: UpdateServiceDto) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException('Service not found.');

    if (dto.pricingType && !PRICING.includes(dto.pricingType)) {
      throw new BadRequestException(
        'pricingType must be FIXED, HOURLY, or VISITING.',
      );
    }
    this.assertPaise('basePrice', dto.basePrice);
    this.assertPaise('hourlyRate', dto.hourlyRate);
    this.assertPaise('visitFee', dto.visitFee);
    this.assertPaise('startingPrice', dto.startingPrice);

    const data: any = {};
    const fields = [
      'name',
      'description',
      'longDescription',
      'imageUrl',
      'imageAlt',
      'hasSubServices',
      'pricingType',
      'basePrice',
      'hourlyRate',
      'visitFee',
      'durationLabel',
      'startingPrice',
      'displayOrder',
      'active',
    ];
    for (const f of fields) {
      if ((dto as any)[f] !== undefined) data[f] = (dto as any)[f];
    }
    if (data.name) data.name = data.name.trim();

    if (dto.categoryId !== undefined) {
      const category = await this.prisma.serviceCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category)
        throw new BadRequestException(
          'categoryId does not refer to a valid category.',
        );
      data.categoryId = dto.categoryId;
    }

    if (dto.slug !== undefined) {
      const slug = this.slugify(dto.slug);
      if (!slug) throw new BadRequestException('Invalid slug.');
      const taken = await this.prisma.service.findFirst({
        where: { slug, NOT: { id } },
      });
      if (taken)
        throw new ConflictException(`Slug "${slug}" is already in use.`);
      data.slug = slug;
    }

    return this.prisma.service.update({ where: { id }, data });
  }

  // Soft delete: services may be referenced by bookings.
  async deleteService(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException('Service not found.');
    await this.prisma.service.update({
      where: { id },
      data: { active: false },
    });
    return {
      ok: true,
      softDeleted: true,
      message: 'Service deactivated (soft delete).',
    };
  }

  // ============ SUB-SERVICES ============

  async createSubService(dto: CreateSubServiceDto) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Sub-service name is required.');
    if (!dto.serviceId) throw new BadRequestException('serviceId is required.');

    const parent = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
    });
    if (!parent)
      throw new BadRequestException(
        'serviceId does not refer to a valid service.',
      );

    if (!dto.pricingType || !PRICING.includes(dto.pricingType)) {
      throw new BadRequestException(
        'pricingType is required and must be FIXED, HOURLY, or VISITING.',
      );
    }
    this.assertPaise('basePrice', dto.basePrice);
    this.assertPaise('hourlyRate', dto.hourlyRate);
    this.assertPaise('visitFee', dto.visitFee);

    const sub = await this.prisma.subService.create({
      data: {
        serviceId: dto.serviceId,
        name,
        description: dto.description ?? null,
        pricingType: dto.pricingType,
        basePrice: dto.basePrice ?? null,
        hourlyRate: dto.hourlyRate ?? null,
        visitFee: dto.visitFee ?? null,
        durationLabel: dto.durationLabel ?? null,
        displayOrder: dto.displayOrder ?? 0,
        active: dto.active ?? true,
      },
    });

    // if a service gains sub-services, make sure the flag reflects it
    if (!parent.hasSubServices) {
      await this.prisma.service.update({
        where: { id: dto.serviceId },
        data: { hasSubServices: true },
      });
    }
    return sub;
  }

  async updateSubService(id: string, dto: UpdateSubServiceDto) {
    const sub = await this.prisma.subService.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Sub-service not found.');

    if (dto.pricingType && !PRICING.includes(dto.pricingType)) {
      throw new BadRequestException(
        'pricingType must be FIXED, HOURLY, or VISITING.',
      );
    }
    this.assertPaise('basePrice', dto.basePrice);
    this.assertPaise('hourlyRate', dto.hourlyRate);
    this.assertPaise('visitFee', dto.visitFee);

    const data: any = {};
    const fields = [
      'name',
      'description',
      'pricingType',
      'basePrice',
      'hourlyRate',
      'visitFee',
      'durationLabel',
      'displayOrder',
      'active',
    ];
    for (const f of fields) {
      if ((dto as any)[f] !== undefined) data[f] = (dto as any)[f];
    }
    if (data.name) data.name = data.name.trim();

    return this.prisma.subService.update({ where: { id }, data });
  }

  async deleteSubService(id: string) {
    const sub = await this.prisma.subService.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Sub-service not found.');
    await this.prisma.subService.update({
      where: { id },
      data: { active: false },
    });
    return {
      ok: true,
      softDeleted: true,
      message: 'Sub-service deactivated (soft delete).',
    };
  }

  // ============ PINCODES ============

  listPincodes() {
    return this.prisma.serviceablePincode.findMany({
      orderBy: { pincode: 'asc' },
    });
  }

  async createPincode(dto: CreatePincodeDto) {
    const pincode = (dto.pincode ?? '').trim();
    if (!/^\d{6}$/.test(pincode)) {
      throw new BadRequestException('Pincode must be a 6-digit number.');
    }
    const areaName = (dto.areaName ?? '').trim();
    if (!areaName) {
      throw new BadRequestException('areaName is required.');
    }
    const city = (dto.city ?? '').trim() || 'Hyderabad';

    const existing = await this.prisma.serviceablePincode.findFirst({
      where: { pincode },
    });
    if (existing) throw new ConflictException('This pincode already exists.');

    return this.prisma.serviceablePincode.create({
      data: {
        pincode,
        areaName,
        city,
        active: dto.active ?? true,
      },
    });
  }

  async updatePincode(id: string, dto: UpdatePincodeDto) {
    const pin = await this.prisma.serviceablePincode.findUnique({
      where: { id },
    });
    if (!pin) throw new NotFoundException('Pincode not found.');

    const data: any = {};
    if (dto.areaName !== undefined) {
      const areaName = dto.areaName.trim();
      if (!areaName) throw new BadRequestException('areaName cannot be empty.');
      data.areaName = areaName;
    }
    if (dto.city !== undefined) {
      const city = dto.city.trim();
      if (!city) throw new BadRequestException('city cannot be empty.');
      data.city = city;
    }
    if (dto.active !== undefined) data.active = dto.active;

    return this.prisma.serviceablePincode.update({ where: { id }, data });
  }

  async deletePincode(id: string) {
    const pin = await this.prisma.serviceablePincode.findUnique({
      where: { id },
    });
    if (!pin) throw new NotFoundException('Pincode not found.');
    await this.prisma.serviceablePincode.delete({ where: { id } });
    return { ok: true };
  }
}
