import { ConfigService } from '@nestjs/config';
import {
  StandardCheckoutClient,
  StandardCheckoutPayRequest,
  Env,
  CallbackResponse,
} from '@phonepe-pg/pg-sdk-node';
import {
  PaymentProvider,
  CreatePaymentResult,
  PaymentVerifyResult,
} from '../payment-provider.interface';

/**
 * PhonePe Standard Checkout (v2 OAuth SDK) provider.
 *
 * Outbound calls (pay / getOrderStatus) authenticate with the Client
 * ID / Secret / Version. Inbound webhook validation uses the
 * dashboard-configured username/password via client.validateCallback().
 *
 * merchantOrderId == our Order.id (locked decision).
 * Amounts are in paise (integer), matching the rest of the app.
 */
export class PhonePeProvider implements PaymentProvider {
  readonly name = 'phonepe';

  private client: StandardCheckoutClient | null = null;

  constructor(private config: ConfigService) {}

  private getClient(): StandardCheckoutClient {
    if (this.client) return this.client;

    const clientId = this.config.get<string>('PHONEPE_CLIENT_ID');
    const clientSecret = this.config.get<string>('PHONEPE_CLIENT_SECRET');
    const clientVersionRaw = this.config.get<string>('PHONEPE_CLIENT_VERSION');
    const envRaw = this.config.get<string>('PHONEPE_ENV');

    if (!clientId || !clientSecret || !clientVersionRaw || !envRaw) {
      throw new Error(
        'PhonePe is not configured: set PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION, PHONEPE_ENV',
      );
    }

    const clientVersion = Number(clientVersionRaw);
    if (Number.isNaN(clientVersion)) {
      throw new Error('PHONEPE_CLIENT_VERSION must be a number');
    }

    const env = envRaw === 'PRODUCTION' ? Env.PRODUCTION : Env.SANDBOX;

    // getInstance is a singleton inside the SDK; safe to call repeatedly.
    this.client = StandardCheckoutClient.getInstance(
      clientId,
      clientSecret,
      clientVersion,
      env,
    );
    return this.client;
  }

  /**
   * Initiates a PhonePe order and returns the hosted checkout redirect URL.
   */
  async createPayment(
    orderId: string,
    amount: number,
  ): Promise<CreatePaymentResult> {
    const redirectUrl = this.config.get<string>('PHONEPE_REDIRECT_URL');
    if (!redirectUrl) {
      throw new Error('PHONEPE_REDIRECT_URL is not set');
    }

    const request = StandardCheckoutPayRequest.builder()
      .merchantOrderId(orderId)
      .amount(amount)
      .redirectUrl(`${redirectUrl}?orderId=${orderId}`)
      .build();

    const response = await this.getClient().pay(request);

    return {
      provider: this.name,
      gatewayOrderId: response.orderId,
      redirectUrl: response.redirectUrl,
      merchantOrderId: orderId,
      confirmImmediately: false, // settled via return-page status check + webhook
    };
  }

  /**
   * Server-to-server confirmation used by the return/status endpoint.
   * Matches the PaymentProvider.verifyPayment signature.
   */
  async verifyPayment(merchantOrderId: string): Promise<PaymentVerifyResult> {
    const status = await this.getClient().getOrderStatus(merchantOrderId);
    const gatewayPaymentId = status.paymentDetails?.[0]?.transactionId;

    if (status.state === 'COMPLETED') {
      return { state: 'PAID', gatewayPaymentId, raw: status };
    }
    if (status.state === 'FAILED') {
      return { state: 'FAILED', gatewayPaymentId, raw: status };
    }
    return { state: 'PENDING', gatewayPaymentId, raw: status };
  }

  /**
   * Provider-specific helper (not part of PaymentProvider): validates a
   * webhook and returns a normalized outcome, or null if it is not a
   * terminal order event we act on. The controller calls this directly.
   */
  validateWebhook(
    authorization: string,
    rawBody: string,
  ): {
    merchantOrderId: string;
    state: 'PAID' | 'FAILED';
    gatewayPaymentId?: string;
  } | null {
    const username = this.config.get<string>('PHONEPE_WEBHOOK_USERNAME');
    const password = this.config.get<string>('PHONEPE_WEBHOOK_PASSWORD');
    if (!username || !password) {
      throw new Error(
        'PhonePe webhook not configured: set PHONEPE_WEBHOOK_USERNAME, PHONEPE_WEBHOOK_PASSWORD',
      );
    }

    // Throws PhonePeException if the signature is invalid.
    const callback: CallbackResponse = this.getClient().validateCallback(
      username,
      password,
      authorization,
      rawBody,
    );

    const payload = callback.payload;
    const merchantOrderId = payload.merchantOrderId;
    if (!merchantOrderId) return null;

    const gatewayPaymentId = payload.paymentDetails?.[0]?.transactionId;

    if (payload.state === 'COMPLETED') {
      return { merchantOrderId, state: 'PAID', gatewayPaymentId };
    }
    if (payload.state === 'FAILED') {
      return { merchantOrderId, state: 'FAILED', gatewayPaymentId };
    }
    return null;
  }
}
