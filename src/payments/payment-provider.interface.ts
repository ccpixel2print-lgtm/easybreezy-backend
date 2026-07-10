export interface CreatePaymentResult {
  provider: string;
  // For gateway providers, the client needs these to open checkout:
  gatewayOrderId?: string;
  // Whether the order should immediately enter operations (COD) or wait for payment (gateway):
  confirmImmediately: boolean;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(orderId: string, amount: number): Promise<CreatePaymentResult>;
}
