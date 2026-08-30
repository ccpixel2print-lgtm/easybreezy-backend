import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
