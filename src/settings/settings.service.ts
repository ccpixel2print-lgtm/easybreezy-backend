import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PricingSettings,
  ConfigurableFee,
  DEFAULT_PRICING,
  PaymentsSettings,
  DEFAULT_PAYMENTS,
  KNOWN_PROVIDERS,
} from './settings.types';

const PRICING_GROUP = 'pricing';
const PAYMENTS_GROUP = 'payments';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  // ==================== PRICING ====================

  async getPricing(): Promise<PricingSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { group: PRICING_GROUP },
    });
    if (!row) return DEFAULT_PRICING;
    return this.mergePricing(row.value as Partial<PricingSettings>);
  }

  async updatePricing(
    patch: Partial<PricingSettings>,
  ): Promise<PricingSettings> {
    const current = await this.getPricing();

    const next: PricingSettings = {
      gstEnabled: patch.gstEnabled ?? current.gstEnabled,
      gstRate: patch.gstRate ?? current.gstRate,
      platformFee: this.mergeFee(current.platformFee, patch.platformFee),
      convenienceFee: this.mergeFee(
        current.convenienceFee,
        patch.convenienceFee,
      ),
    };

    this.validate(next);

    await this.prisma.appSetting.upsert({
      where: { group: PRICING_GROUP },
      create: {
        group: PRICING_GROUP,
        value: next as unknown as Prisma.InputJsonValue,
      },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });

    return next;
  }

  // ==================== PAYMENTS ====================

  async getPayments(): Promise<PaymentsSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { group: PAYMENTS_GROUP },
    });
    if (!row) return DEFAULT_PAYMENTS;
    return this.mergePayments(row.value as Partial<PaymentsSettings>);
  }

  async updatePayments(
    patch: Partial<PaymentsSettings>,
  ): Promise<PaymentsSettings> {
    const current = await this.getPayments();

    const next: PaymentsSettings = {
      activeProvider: patch.activeProvider ?? current.activeProvider,
      enabledProviders: patch.enabledProviders ?? current.enabledProviders,
    };

    this.validatePayments(next);

    await this.prisma.appSetting.upsert({
      where: { group: PAYMENTS_GROUP },
      create: {
        group: PAYMENTS_GROUP,
        value: next as unknown as Prisma.InputJsonValue,
      },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });

    return next;
  }

  // ==================== HELPERS ====================

  private mergePricing(v: Partial<PricingSettings>): PricingSettings {
    return {
      gstEnabled: v.gstEnabled ?? DEFAULT_PRICING.gstEnabled,
      gstRate: v.gstRate ?? DEFAULT_PRICING.gstRate,
      platformFee: this.mergeFee(DEFAULT_PRICING.platformFee, v.platformFee),
      convenienceFee: this.mergeFee(
        DEFAULT_PRICING.convenienceFee,
        v.convenienceFee,
      ),
    };
  }

  private mergeFee(
    base: ConfigurableFee,
    patch?: Partial<ConfigurableFee>,
  ): ConfigurableFee {
    return {
      enabled: patch?.enabled ?? base.enabled,
      type: patch?.type ?? base.type,
      value: patch?.value ?? base.value,
    };
  }

  private validate(s: PricingSettings) {
    if (typeof s.gstRate !== 'number' || s.gstRate < 0 || s.gstRate > 1) {
      throw new BadRequestException(
        'gstRate must be a decimal between 0 and 1 (e.g. 0.18 for 18%).',
      );
    }
    for (const [label, fee] of [
      ['platformFee', s.platformFee],
      ['convenienceFee', s.convenienceFee],
    ] as const) {
      if (fee.type !== 'FLAT' && fee.type !== 'PERCENT') {
        throw new BadRequestException(`${label}.type must be FLAT or PERCENT.`);
      }
      if (!Number.isInteger(fee.value) || fee.value < 0) {
        throw new BadRequestException(
          `${label}.value must be a non-negative integer (paise for FLAT, percent for PERCENT).`,
        );
      }
      if (fee.type === 'PERCENT' && fee.value > 100) {
        throw new BadRequestException(
          `${label}.value cannot exceed 100 for a PERCENT fee.`,
        );
      }
    }
  }

  private mergePayments(v: Partial<PaymentsSettings>): PaymentsSettings {
    return {
      activeProvider: v.activeProvider ?? DEFAULT_PAYMENTS.activeProvider,
      enabledProviders: v.enabledProviders ?? DEFAULT_PAYMENTS.enabledProviders,
    };
  }

  private validatePayments(s: PaymentsSettings) {
    if (!Array.isArray(s.enabledProviders) || s.enabledProviders.length === 0) {
      throw new BadRequestException(
        'enabledProviders must be a non-empty array.',
      );
    }
    const known = KNOWN_PROVIDERS as readonly string[];
    for (const p of s.enabledProviders) {
      if (!known.includes(p)) {
        throw new BadRequestException(
          `Unknown provider "${p}". Known: ${known.join(', ')}.`,
        );
      }
    }
    if (!known.includes(s.activeProvider)) {
      throw new BadRequestException(
        `Unknown activeProvider "${s.activeProvider}".`,
      );
    }
    if (!s.enabledProviders.includes(s.activeProvider)) {
      throw new BadRequestException(
        'activeProvider must be one of the enabledProviders.',
      );
    }
  }
}
