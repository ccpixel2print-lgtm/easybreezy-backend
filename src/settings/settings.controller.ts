import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PricingSettings } from './settings.types';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

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
}
