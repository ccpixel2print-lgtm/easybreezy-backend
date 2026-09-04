import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingType, NotificationType } from '@prisma/client';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { PricingSettings, ConfigurableFee } from '../settings/settings.types';
import { NotificationsService } from '../notifications/notifications.service';

export interface CheckoutItemInput {
  serviceId: string;
  subServiceId?: string | null;
  quantity?: number; // hours for HOURLY, else defaults to 1
}

export interface CheckoutInput {
  items: CheckoutItemInput[];
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  addressLine1: string;
  addressLine2?: string;
  area?: string;
  city: string;
  pincode: string;
  scheduledDate: string; // ISO date string
  scheduledTimeWindow: string; // e.g. "10:00 AM – 12:00 PM"
}

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private settings: SettingsService,
    private notifications: NotificationsService,
  ) {}

  /** Resolve a configurable fee to paise, given the service-charge base. */
  private computeFee(fee: ConfigurableFee, serviceCharge: number): number {
    if (!fee.enabled || fee.value <= 0) return 0;
    if (fee.type === 'PERCENT') {
      return Math.round(serviceCharge * (fee.value / 100));
    }
    return fee.value; // FLAT paise
  }

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
    if (
      !input.contactName ||
      !input.contactPhone ||
      !input.addressLine1 ||
      !input.pincode
    ) {
      throw new BadRequestException('Missing required checkout details.');
    }

    // Validate serviceability
    const serviceable = await this.prisma.serviceablePincode.findFirst({
      where: { pincode: input.pincode, active: true },
    });
    if (!serviceable) {
      throw new BadRequestException('Sorry, we do not serve this pincode yet.');
    }

    // Back-fill the customer's profile from checkout contact details when
    // missing. OTP customers register with email only, so fullName/phone are
    // otherwise never set — which breaks admin customer/booking views and LTV.
    // Only fills blanks; never overwrites a name/phone the user already has.
    const existing = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { fullName: true, phone: true },
    });
    const backfill: { fullName?: string; phone?: string } = {};
    if (!existing?.fullName && input.contactName) {
      backfill.fullName = input.contactName;
    }
    if (!existing?.phone && input.contactPhone) {
      backfill.phone = input.contactPhone;
    }
    if (Object.keys(backfill).length > 0) {
      await this.prisma.user.update({
        where: { id: customerId },
        data: backfill,
      });
    }

    // Load pricing settings once (GST rate + configurable fees).
    const pricing: PricingSettings = await this.settings.getPricing();
    // GST only applies when enabled; otherwise the effective rate is 0.
    const gstRate = pricing.gstEnabled ? pricing.gstRate : 0;

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
        unitPrice = this.resolvePrice(
          sub.pricingType,
          sub.basePrice,
          sub.hourlyRate,
          sub.visitFee,
        );
        itemName = sub.name;
        subServiceId = sub.id;
      } else {
        if (service.hasSubServices) {
          throw new BadRequestException(
            `Please choose a package for ${service.name}.`,
          );
        }
        if (!service.pricingType) {
          throw new BadRequestException(
            `Service ${service.name} is not bookable.`,
          );
        }
        pricingType = service.pricingType;
        unitPrice = this.resolvePrice(
          service.pricingType,
          service.basePrice,
          service.hourlyRate,
          service.visitFee,
        );
        itemName = service.name;
      }

      if (unitPrice <= 0) {
        throw new BadRequestException(`Pricing unavailable for ${itemName}.`);
      }

      const quantity =
        pricingType === 'HOURLY' ? Math.max(1, item.quantity ?? 1) : 1;
      const serviceAmount = unitPrice * quantity;
      const taxAmount = Math.round(serviceAmount * gstRate);
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

    // ---- Order-level money breakdown ----
    // Service charge = sum of all booking service amounts (pre-tax, pre-fee).
    const subtotal = bookingRows.reduce((s, b) => s + b.serviceAmount, 0);

    // Configurable order-level fees (computed on the service charge).
    const platformFee = this.computeFee(pricing.platformFee, subtotal);
    const convenienceFee = this.computeFee(pricing.convenienceFee, subtotal);

    // GST is charged on the full taxable base: service charge + both fees.
    const taxableBase = subtotal + platformFee + convenienceFee;
    const taxAmount = Math.round(taxableBase * gstRate);

    const totalAmount = taxableBase + taxAmount;

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
          platformFee,
          convenienceFee,
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

    // Notify ops that a new booking/order landed (best-effort, post-commit).
    void this.notifyStaff({
      type: 'BOOKING_RECEIVED',
      title: 'New booking received',
      body: `${input.contactName} placed order ${order.orderNumber} (₹${(totalAmount / 100).toFixed(2)}) for ${input.pincode}.`,
      data: { orderId: order.id, orderNumber: order.orderNumber },
      email: {
        subject: `New booking ${order.orderNumber}`,
        html: `<p>New order <strong>${order.orderNumber}</strong> from ${input.contactName} (${input.contactPhone}).</p><p>Total ₹${(totalAmount / 100).toFixed(2)} · ${input.pincode} · ${input.scheduledTimeWindow}</p>`,
        text: `New order ${order.orderNumber} from ${input.contactName}. Total ₹${(totalAmount / 100).toFixed(2)}.`,
      },
    });

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
    if (order.customerId !== customerId)
      throw new ForbiddenException('Not your order.');
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

  /** Fan out an in-app notification to every active ADMIN + SUPERVISOR. */
  private async notifyStaff(msg: {
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    email?: { subject: string; html: string; text: string };
  }) {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERVISOR'] }, status: 'active' },
      select: { id: true, email: true },
    });
    // First recipient carries the email (BCC'd to the ops/CC address via
    // settings); the rest get in-app only, so we don't spam every inbox.
    let emailAttached = false;
    for (const s of staff) {
      void this.notifications.notify({
        userId: s.id,
        type: msg.type,
        title: msg.title,
        body: msg.body,
        data: msg.data,
        email:
          !emailAttached && msg.email && s.email
            ? { to: s.email, ...msg.email }
            : undefined,
      });
      if (msg.email && s.email) emailAttached = true;
    }
  }
}
