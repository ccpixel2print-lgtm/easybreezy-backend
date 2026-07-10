import { Body, Controller, Post } from '@nestjs/common';
import { ServiceabilityService } from './serviceability.service';

@Controller('serviceability')
export class ServiceabilityController {
  constructor(private serviceabilityService: ServiceabilityService) {}

  @Post('check')
  check(@Body('pincode') pincode: string) {
    return this.serviceabilityService.check(pincode);
  }
}

@Controller('leads')
export class LeadsController {
  constructor(private serviceabilityService: ServiceabilityService) {}

  @Post()
  capture(
    @Body() body: { pincode: string; email?: string; phone?: string; serviceId?: string },
  ) {
    return this.serviceabilityService.captureLead(body);
  }
}
