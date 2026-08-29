import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface StoredObject {
  objectKey: string;
  url: string;
}

@Injectable()
export class StorageService {
  private client: S3Client | null = null;
  private bucket = '';
  private publicBaseUrl = '';

  constructor(private config: ConfigService) {}

  /** True only when all required R2 settings are present. */
  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('R2_ACCOUNT_ID') &&
      this.config.get<string>('R2_ACCESS_KEY_ID') &&
      this.config.get<string>('R2_SECRET_ACCESS_KEY') &&
      this.config.get<string>('R2_BUCKET') &&
      this.config.get<string>('R2_PUBLIC_BASE_URL'),
    );
  }

  /** Lazily build the S3 client; throws a clear error if R2 isn't configured yet. */
  private getClient(): S3Client {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException(
        'File storage (Cloudflare R2) is not configured yet. Set R2_* env vars.',
      );
    }
    if (!this.client) {
      const accountId = this.config.get<string>('R2_ACCOUNT_ID')!;
      this.bucket = this.config.get<string>('R2_BUCKET')!;
      this.publicBaseUrl = this.config
        .get<string>('R2_PUBLIC_BASE_URL')!
        .replace(/\/+$/, ''); // strip trailing slash
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID')!,
          secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY')!,
        },
      });
    }
    return this.client;
  }

  /**
   * Upload a file buffer to R2 and return its object key + public URL.
   * @param objectKey e.g. "bookings/<id>/before/<uuid>.jpg"
   */
  async upload(
    objectKey: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    const client = this.getClient();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
    return {
      objectKey,
      url: `${this.publicBaseUrl}/${objectKey}`,
    };
  }
}
