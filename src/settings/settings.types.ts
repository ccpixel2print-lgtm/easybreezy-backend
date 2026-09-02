export type FeeType = 'FLAT' | 'PERCENT';

export interface ConfigurableFee {
  enabled: boolean;
  type: FeeType;
  value: number; // paise if FLAT; whole-number percent if PERCENT (e.g. 5 = 5%)
}

export interface PricingSettings {
  gstEnabled: boolean; // when false, no GST is charged
  gstRate: number; // decimal, e.g. 0.18
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

// ---- Payments settings group ----

// Known provider names the system can register. 'phonepe' added in this change.
export const KNOWN_PROVIDERS = ['mock', 'cod', 'phonepe'] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

export interface PaymentsSettings {
  activeProvider: string; // which provider is used for new orders
  enabledProviders: string[]; // providers an admin has turned on
}

// Defaults reproduce today's behavior: mock active, mock+cod available.
export const DEFAULT_PAYMENTS: PaymentsSettings = {
  activeProvider: 'mock',
  enabledProviders: ['mock', 'cod'],
};

export interface PayoutsSettings {
  defaultPayoutPercent: number; // whole-number percent, e.g. 70 = 70%
}

export const DEFAULT_PAYOUTS: PayoutsSettings = {
  defaultPayoutPercent: 70,
};

// ---- Notifications settings group ----

export interface NotificationsSettings {
  // Optional internal address BCC'd on every customer/employee email.
  // Empty string = disabled.
  ccEmail: string;
}

export const DEFAULT_NOTIFICATIONS: NotificationsSettings = {
  ccEmail: '',
};
