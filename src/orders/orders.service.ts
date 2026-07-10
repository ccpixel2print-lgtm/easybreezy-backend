import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingType } from '@prisma/client';
import { PaymentsService } from '../payments/payments.service';

const GST_RATE = 0.18;

interface CheckoutItemInput {
  serviceId: string;
  subServiceId?: string | null;
  quantity?: number; // hours for HOURLY, else defaults to 1
}

interface CheckoutInput {
  items: CheckoutItemInput[];
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  addressLine1: string;
  addressLine2?: string;
  area?: string;
  city: string;
  pincode: string;
  scheduledDate: string;        // ISO date string
  scheduledTimeWindow: string;  // e.g. "10:00 AM – 12:00 PM"
}

@Injectable()
export class OrdersService {
  constructor(
  private prisma: PrismaService,
  private payments: PaymentsService,
) {}

  // Determine the effective unit price (in paise) for a booked item, from DB.
  private resolvePrice(
    pricingType: PricingType,
    basePrice: number | null,
    hourlyRate: number | null,
    visitFee: number | null,
  ): number {
    switch (pricingType) {
      case 'FIXED':
        return basePrice ?? 0;
      case 'HOURLY':
        return hourlyRate ?? 0;
      case 'VISITING':
        return visitFee ?? 0; // only the visit fee is charged upfront
      default:
        return 0;
    }
  }

  async checkout(customerId: string, input: CheckoutInput) {
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('Cart is empty.');
    }
    if (!input.contactName || !input.contactPhone || !input.addressLine1 || !input.pincode) {
      throw new BadRequestException('Missing required checkout details.');
    }

    // Validate serviceability
    const serviceable = await this.prisma.serviceablePincode.findFirst({
      where: { pincode: input.pincode, active: true },
    });
    if (!serviceable) {
      throw new BadRequestException('Sorry, we do not serve this pincode yet.');
    }

    const scheduledDate = new Date(input.scheduledDate);
    if (isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Invalid scheduled date.');
    }

    // Build validated booking rows (prices from DB, never from client)
    const bookingRows: {
      serviceId: string;
      subServiceId: string | null;
      itemName: string;
      pricingType: PricingType;
      unitPrice: number;
      quantity: number;
      serviceAmount: number;
      taxAmount: number;
      totalAmount: number;
    }[] = [];

    for (const item of input.items) {
      const service = await this.prisma.service.findUnique({
        where: { id: item.serviceId },
      });
      if (!service || !service.active) {
        throw new BadRequestException(`Service not available.`);
      }

      let pricingType: PricingType;
      let unitPrice: number;
      let itemName: string;
      let subServiceId: string | null = null;

      if (item.subServiceId) {
        const sub = await this.prisma.subService.findUnique({
          where: { id: item.subServiceId },
        });
        if (!sub || !sub.active || sub.serviceId !== service.id) {
          throw new BadRequestException('Selected package is not available.');
        }
        pricingType = sub.pricingType;
        unitPrice = this.resolvePrice(sub.pricingType, sub.basePrice, sub.hourlyRate, sub.visitFee);
        itemName = sub.name;
        subServiceId = sub.id;
      } else {
        if (service.hasSubServices) {
          throw new BadRequestException(`Please choose a package for ${service.name}.`);
        }
        if (!service.pricingType) {
          throw new BadRequestException(`Service ${service.name} is not bookable.`);
        }
        pricingType = service.pricingType;
        unitPrice = this.resolvePrice(service.pricingType, service.basePrice, service.hourlyRate, service.visitFee);
        itemName = service.name;
      }

      if (unitPrice <= 0) {
        throw new BadRequestException(`Pricing unavailable for ${itemName}.`);
      }

      const quantity = pricingType === 'HOURLY' ? Math.max(1, item.quantity ?? 1) : 1;
      const serviceAmount = unitPrice * quantity;
      const taxAmount = Math.round(serviceAmount * GST_RATE);
      const totalAmount = serviceAmount + taxAmount;

      bookingRows.push({
        serviceId: service.id,
        subServiceId,
        itemName,
        pricingType,
        unitPrice,
        quantity,
        serviceAmount,
        taxAmount,
        totalAmount,
      });
    }

    const subtotal = bookingRows.reduce((s, b) => s + b.serviceAmount, 0);
    const taxAmount = bookingRows.reduce((s, b) => s + b.taxAmount, 0);
    const totalAmount = subtotal + taxAmount;

    const orderNumber = this.generateNumber('EB');

    // Create order + bookings atomically
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          customerId,
          status: 'PENDING_PAYMENT',
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 ?? null,
          area: input.area ?? null,
          city: input.city,
          pincode: input.pincode,
          subtotal,
          taxAmount,
          totalAmount,
        },
      });

      for (const b of bookingRows) {
        await tx.booking.create({
          data: {
            bookingNumber: this.generateNumber('BK'),
            orderId: created.id,
            customerId,
            serviceId: b.serviceId,
            subServiceId: b.subServiceId,
            itemName: b.itemName,
            pricingType: b.pricingType,
            unitPrice: b.unitPrice,
            quantity: b.quantity,
            serviceAmount: b.serviceAmount,
            taxAmount: b.taxAmount,
            totalAmount: b.totalAmount,
            scheduledDate,
            scheduledTimeWindow: input.scheduledTimeWindow,
            addressLine1: input.addressLine1,
            addressLine2: input.addressLine2 ?? null,
            area: input.area ?? null,
            city: input.city,
            pincode: input.pincode,
            status: 'PENDING_PAYMENT',
            source: 'web',
          },
        });
      }

      return created;
    });

    const paymentInfo = await this.payments.initiatePayment(order.id);
    const fullOrder = await this.getOrderForCustomer(customerId, order.id);
    return { order: fullOrder, payment: paymentInfo };

  }

  async listOrders(customerId: string) {
    return this.prisma.order.findMany({
      where: { customerId },
      orderBy: { placedAt: 'desc' },
      include: { bookings: true },
    });
  }

  async getOrderForCustomer(customerId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { bookings: true },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.customerId !== customerId) throw new ForbiddenException('Not your order.');
    return order;
  }

  async listBookings(customerId: string) {
    return this.prisma.booking.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private generateNumber(prefix: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${ts}${rand}`;
  }
}
