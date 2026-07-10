import { PaymentProvider, CreatePaymentResult } from '../payment-provider.interface';

export class MockProvider implements PaymentProvider {
  readonly name = 'mock';

  async createPayment(orderId: string, _amount: number): Promise<CreatePaymentResult> {
    // Simulate a gateway order id; confirmation happens via the mock confirm endpoint.
    return {
      provider: this.name,
      gatewayOrderId: `mock_order_${orderId}`,
      confirmImmediately: false, // requires an explicit "confirm" call to simulate payment
    };
  }
}
