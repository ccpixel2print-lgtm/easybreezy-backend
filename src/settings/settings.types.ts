export type FeeType = 'FLAT' | 'PERCENT';

export interface ConfigurableFee {
  enabled: boolean;
  type: FeeType;
  value: number; // paise if FLAT; whole-number percent if PERCENT (e.g. 5 = 5%)
}

export interface PricingSettings {
  gstEnabled: boolean;          // when false, no GST is charged
  gstRate: number;              // decimal, e.g. 0.18
  platformFee: ConfigurableFee;
  convenienceFee: ConfigurableFee;
}

// Defaults reproduce today's live behavior exactly:
// GST on at 18%, both fees off.
export const DEFAULT_PRICING: PricingSettings = {
  gstEnabled: true,
  gstRate: 0.18,
  platformFee: { enabled: false, type: 'FLAT', value: 0 },
  convenienceFee: { enabled: false, type: 'FLAT', value: 0 },
};
