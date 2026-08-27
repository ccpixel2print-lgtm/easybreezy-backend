export interface CreatePaymentResult {
  provider: string;
  // For gateway providers, the client needs these to open checkout:
  gatewayOrderId?: string;
  // Redirect-based gateways (e.g. PhonePe) return a hosted checkout URL:
  redirectUrl?: string;
  // The id we sent to the gateway as the merchant order id (== our Order.id):
  merchantOrderId?: string;
  // Whether the order should immediately enter operations (COD) or wait for payment (gateway):
  confirmImmediately: boolean;
}

// Normalized status returned by a gateway status/verify check.
export type PaymentVerifyState = 'PAID' | 'PENDING' | 'FAILED';

export interface PaymentVerifyResult {
  state: PaymentVerifyState;
  gatewayPaymentId?: string;
  raw?: unknown; // provider's raw response, for logging/debugging
}

export interface PaymentProvider {
  readonly name: string;

  createPayment(orderId: string, amount: number): Promise<CreatePaymentResult>;

  // Optional: redirect/gateway providers implement this to confirm real status.
  verifyPayment?(merchantOrderId: string): Promise<PaymentVerifyResult>;

  // Optional: deferred for now (refunds handled via PG dashboard initially).
  refund?(
    merchantOrderId: string,
    amount: number,
    refundId: string,
  ): Promise<unknown>;
}
