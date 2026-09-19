import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, SettingsModule, PaymentsModule, NotificationsModule],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
