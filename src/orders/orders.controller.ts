import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtGuard)
@Controller('me')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post('checkout')
  checkout(@CurrentUser() user: { id: string }, @Body() body: any) {
    return this.ordersService.checkout(user.id, body);
  }

  @Get('orders')
  listOrders(@CurrentUser() user: { id: string }) {
    return this.ordersService.listOrders(user.id);
  }

  @Get('orders/:id')
  getOrder(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.ordersService.getOrderForCustomer(user.id, id);
  }

  @Get('bookings')
  listBookings(@CurrentUser() user: { id: string }) {
    return this.ordersService.listBookings(user.id);
  }
}
