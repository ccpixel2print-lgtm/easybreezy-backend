export type FeeType = 'FLAT' | 'PERCENT';

export interface ConfigurableFee {
  enabled: boolean;
  type: FeeType;
  value: number; // paise if FLAT; whole-number percent if PERCENT (e.g. 5 = 5%)
}

export interface PricingSettings {
  gstRate: number;              // decimal, e.g. 0.18
  platformFee: ConfigurableFee;
  convenienceFee: ConfigurableFee;
}

// Defaults reproduce today's live behavior exactly:
// GST 18%, both fees disabled and zero → total = subtotal + 18% GST, unchanged.
export const DEFAULT_PRICING: PricingSettings = {
  gstRate: 0.18,
  platformFee: { enabled: false, type: 'FLAT', value: 0 },
  convenienceFee: { enabled: false, type: 'FLAT', value: 0 },
};
