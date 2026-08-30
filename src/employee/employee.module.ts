import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmployeeService } from './employee.service';
import { EmployeeController } from './employee.controller';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { StorageModule } from '../storage/storage.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    StorageModule,
    WalletModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [EmployeeController],
  providers: [EmployeeService, JwtGuard, RolesGuard],
})
export class EmployeeModule {}
