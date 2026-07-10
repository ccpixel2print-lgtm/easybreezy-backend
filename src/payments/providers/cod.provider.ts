import { PaymentProvider, CreatePaymentResult } from '../payment-provider.interface';

export class CodProvider implements PaymentProvider {
  readonly name = 'cod';

  async createPayment(_orderId: string, _amount: number): Promise<CreatePaymentResult> {
    // COD: no gateway; order enters ops immediately, payment stays pending.
    return {
      provider: this.name,
      confirmImmediately: true,
    };
  }
}
