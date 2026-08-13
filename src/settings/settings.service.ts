import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PricingSettings,
  ConfigurableFee,
  FeeType,
  DEFAULT_PRICING,
} from './settings.types';

const PRICING_GROUP = 'pricing';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  /** Read the pricing group, merged over defaults so missing keys are safe. */
  async getPricing(): Promise<PricingSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { group: PRICING_GROUP },
    });
    if (!row) return DEFAULT_PRICING;
    return this.mergePricing(row.value as Partial<PricingSettings>);
  }

  /** Admin update — validate, merge over current, upsert the whole group. */
  async updatePricing(patch: Partial<PricingSettings>): Promise<PricingSettings> {
    const current = await this.getPricing();

    const next: PricingSettings = {
      gstEnabled: patch.gstEnabled ?? current.gstEnabled,
      gstRate: patch.gstRate ?? current.gstRate,
      platformFee: this.mergeFee(current.platformFee, patch.platformFee),
      convenienceFee: this.mergeFee(current.convenienceFee, patch.convenienceFee),
    };

    this.validate(next);

    await this.prisma.appSetting.upsert({
      where: { group: PRICING_GROUP },
      create: { group: PRICING_GROUP, value: next as any },
      update: { value: next as any },
    });

    return next;
  }

  // ---- helpers ----

  private mergePricing(v: Partial<PricingSettings>): PricingSettings {
    return {
      gstEnabled: v.gstEnabled ?? DEFAULT_PRICING.gstEnabled,
      gstRate: v.gstRate ?? DEFAULT_PRICING.gstRate,
      platformFee: this.mergeFee(DEFAULT_PRICING.platformFee, v.platformFee),
      convenienceFee: this.mergeFee(DEFAULT_PRICING.convenienceFee, v.convenienceFee),
    };
  }

  private mergeFee(base: ConfigurableFee, patch?: Partial<ConfigurableFee>): ConfigurableFee {
    return {
      enabled: patch?.enabled ?? base.enabled,
      type: (patch?.type ?? base.type) as FeeType,
      value: patch?.value ?? base.value,
    };
  }

  private validate(s: PricingSettings) {
    if (typeof s.gstRate !== 'number' || s.gstRate < 0 || s.gstRate > 1) {
      throw new BadRequestException('gstRate must be a decimal between 0 and 1 (e.g. 0.18 for 18%).');
    }
    for (const [label, fee] of [
      ['platformFee', s.platformFee],
      ['convenienceFee', s.convenienceFee],
    ] as const) {
      if (fee.type !== 'FLAT' && fee.type !== 'PERCENT') {
        throw new BadRequestException(`${label}.type must be FLAT or PERCENT.`);
      }
      if (!Number.isInteger(fee.value) || fee.value < 0) {
        throw new BadRequestException(`${label}.value must be a non-negative integer (paise for FLAT, percent for PERCENT).`);
      }
      if (fee.type === 'PERCENT' && fee.value > 100) {
        throw new BadRequestException(`${label}.value cannot exceed 100 for a PERCENT fee.`);
      }
    }
  }
}
