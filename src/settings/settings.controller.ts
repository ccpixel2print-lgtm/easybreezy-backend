import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import {
  PricingSettings,
  PaymentsSettings,
  PayoutsSettings,
} from './settings.types';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('pricing-config')
export class PublicPricingController {
  constructor(private settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getPricing();
  }
}

@UseGuards(JwtGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get('pricing')
  getPricing() {
    return this.settings.getPricing();
  }

  @Patch('pricing')
  updatePricing(@Body() body: Partial<PricingSettings>) {
    return this.settings.updatePricing(body);
  }

  @Get('payments')
  getPayments() {
    return this.settings.getPayments();
  }

  @Patch('payments')
  updatePayments(@Body() body: Partial<PaymentsSettings>) {
    return this.settings.updatePayments(body);
  }

  @Get('payouts')
  getPayouts() {
    return this.settings.getPayouts();
  }

  @Patch('payouts')
  updatePayouts(@Body() body: Partial<PayoutsSettings>) {
    return this.settings.updatePayouts(body);
  }
}
