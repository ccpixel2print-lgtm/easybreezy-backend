import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(private prisma: PrismaService) {}

  // ---- Aggregate summary metrics ----
  async getDashboard() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [
      ordersByStatus,
      bookingsByStatus,
      paidAgg,
      bookedAgg,
      todaysJobs,
      unassignedCount,
      staffCounts,
      customerCount,
      recentOrders,
    ] = await Promise.all([
      // order counts grouped by status
      this.prisma.order.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      // booking counts grouped by status
      this.prisma.booking.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      // collected revenue: sum of PAID orders' totalAmount
      this.prisma.order.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { totalAmount: true },
      }),
      // booked revenue: value of bookings that are confirmed or beyond
      this.prisma.booking.aggregate({
        where: {
          status: { in: ['CONFIRMED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] },
        },
        _sum: { totalAmount: true },
      }),
      // jobs scheduled for today
      this.prisma.booking.count({
        where: { scheduledDate: { gte: startOfToday, lte: endOfToday } },
      }),
      // unassigned queue (confirmed but no employee)
      this.prisma.booking.count({
        where: { status: 'CONFIRMED', assignedEmployeeId: null },
      }),
      // staff counts by role
      this.prisma.user.groupBy({
        by: ['role'],
        _count: { _all: true },
      }),
      // total customers
      this.prisma.user.count({ where: { role: 'CUSTOMER' } }),
      // 5 most recent orders for a quick glance
      this.prisma.order.findMany({
        take: 5,
        orderBy: { placedAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          totalAmount: true,
          contactName: true,
          placedAt: true,
        },
      }),
    ]);

    // reshape groupBy arrays into simple { STATUS: count } maps
    const toMap = (rows: any[], key: string) =>
      rows.reduce(
        (acc, r) => {
          acc[r[key]] = r._count._all;
          return acc;
        },
        {} as Record<string, number>,
      );

    return {
      revenue: {
        // amounts in paise (divide by 100 for rupees on the frontend)
        paidRevenue: paidAgg._sum.totalAmount ?? 0,
        bookedRevenue: bookedAgg._sum.totalAmount ?? 0,
      },
      orders: {
        byStatus: toMap(ordersByStatus, 'status'),
        total: ordersByStatus.reduce((s, r) => s + r._count._all, 0),
      },
      bookings: {
        byStatus: toMap(bookingsByStatus, 'status'),
        total: bookingsByStatus.reduce((s, r) => s + r._count._all, 0),
      },
      operations: {
        todaysJobs,
        unassignedQueue: unassignedCount,
      },
      staff: toMap(staffCounts, 'role'),
      customerCount,
      recentOrders,
    };
  }

  // ---- Paginated, filterable order list ----
  async listOrders(query: {
    status?: string;
    paymentStatus?: string;
    search?: string;
    from?: string;
    to?: string;
    page?: string;
    pageSize?: string;
  }) {
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(query.pageSize ?? '20', 10) || 20),
    );

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;

    if (query.from || query.to) {
      where.placedAt = {};
      if (query.from) {
        const f = new Date(query.from);
        if (!isNaN(f.getTime())) where.placedAt.gte = f;
      }
      if (query.to) {
        const t = new Date(query.to);
        if (!isNaN(t.getTime())) {
          t.setHours(23, 59, 59, 999);
          where.placedAt.lte = t;
        }
      }
    }

    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { orderNumber: { contains: s, mode: 'insensitive' } },
        { contactName: { contains: s, mode: 'insensitive' } },
        { contactEmail: { contains: s, mode: 'insensitive' } },
        { contactPhone: { contains: s } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          subtotal: true,
          taxAmount: true,
          totalAmount: true,
          contactName: true,
          contactPhone: true,
          city: true,
          pincode: true,
          placedAt: true,
          _count: { select: { bookings: true } },
        },
      }),
    ]);

    return {
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  // ---- Paginated customer list with order stats ----
  async listCustomers(query: {
    search?: string;
    page?: string;
    pageSize?: string;
  }) {
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(query.pageSize ?? '20', 10) || 20),
    );

    const where: any = { role: 'CUSTOMER' };
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { fullName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
      ];
    }

    const [total, customers] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
      }),
    ]);

    // lifetime value (sum of PAID orders) per customer on this page
    const ids = customers.map((c) => c.id);
    const ltvRows = ids.length
      ? await this.prisma.order.groupBy({
          by: ['customerId'],
          where: { customerId: { in: ids }, paymentStatus: 'PAID' },
          _sum: { totalAmount: true },
        })
      : [];
    const ltvMap = ltvRows.reduce(
      (acc, r) => {
        acc[r.customerId] = r._sum.totalAmount ?? 0;
        return acc;
      },
      {} as Record<string, number>,
    );

    const data = customers.map((c) => ({
      ...c,
      orderCount: c._count.orders,
      paidLifetimeValue: ltvMap[c.id] ?? 0, // paise
    }));

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
}
