import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CatalogModule } from './catalog/catalog.module';
import { ServiceabilityModule } from './serviceability/serviceability.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { StaffModule } from './staff/staff.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { MailModule } from './mail/mail.module';
import { EmployeeModule } from './employee/employee.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { CatalogAdminModule } from './catalog-admin/catalog-admin.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule, CatalogModule, ServiceabilityModule, AuthModule, OrdersModule, PaymentsModule, 
    StaffModule, AssignmentsModule, MailModule, EmployeeModule, AdminDashboardModule, 
    CatalogAdminModule, SettingsModule,],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
