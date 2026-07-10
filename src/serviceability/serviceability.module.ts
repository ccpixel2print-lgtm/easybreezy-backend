import { Module } from '@nestjs/common';
import { ServiceabilityController, LeadsController } from './serviceability.controller';
import { ServiceabilityService } from './serviceability.service';

@Module({
  controllers: [ServiceabilityController, LeadsController],
  providers: [ServiceabilityService],
})
export class ServiceabilityModule {}
